import type {
  ExecutionMode,
  GateCheck,
  GateVerdict,
  Policy,
  ProposedAction
} from '@shared/types'
import { EXECUTION_MODES, findNetwork } from '@shared/constants'

export interface GateContext {
  policy: Policy
  mode: ExecutionMode
  /** USD already deployed by the mission this action belongs to. */
  missionDeployedUsd: number
  /** Realised P/L for that mission, negative for a loss. */
  missionRealisedUsd: number
  /** True when the vault is unlocked and could actually sign. */
  vaultUnlocked: boolean
}

function check(id: string, label: string, passed: boolean, detail: string): GateCheck {
  return { id, label, passed, detail }
}

/**
 * The safety gate. Every fund-moving action goes through here, in every mode,
 * including Mission · Full — autonomy changes whether a human is asked, never
 * whether this runs.
 *
 * It is fail-closed in two senses:
 *   1. An unknown network, an unparseable amount or a thrown error is a block,
 *      not a pass. There is no path through this function that reaches 'allow'
 *      without every check having explicitly passed.
 *   2. The agent cannot reach it. The gate reads policy from disk-backed state
 *      in the main process; nothing the model emits is an input to the rules,
 *      only to the action being judged.
 */
export function evaluate(action: ProposedAction, ctx: GateContext): GateVerdict {
  const checks: GateCheck[] = []
  const { policy } = ctx

  try {
    // --- Kill switches -----------------------------------------------------
    checks.push(
      check(
        'emergency-stop',
        'Emergency stop clear',
        !policy.emergencyStop,
        policy.emergencyStop ? 'Emergency stop is engaged.' : 'Not engaged.'
      )
    )

    checks.push(
      check(
        'vault-unlocked',
        'Vault unlocked',
        ctx.vaultUnlocked,
        ctx.vaultUnlocked ? 'Signing key is available.' : 'Vault is locked, nothing can be signed.'
      )
    )

    // --- Network -----------------------------------------------------------
    const network = findNetwork(action.networkId)
    checks.push(
      check(
        'network-known',
        'Network recognised',
        Boolean(network),
        network ? network.label : `Unknown network "${action.networkId}".`
      )
    )

    checks.push(
      check(
        'mainnet-authorised',
        'Mainnet authorisation',
        !network?.isMainnet || policy.mainnetEnabled,
        !network
          ? 'Cannot evaluate without a known network.'
          : network.isMainnet
            ? policy.mainnetEnabled
              ? 'Mainnet is explicitly enabled.'
              : 'Real funds are locked. Enable mainnet in Guardrails first.'
            : 'Testnet, no real funds at risk.'
      )
    )

    // --- Notional ----------------------------------------------------------
    const usd = Number(action.estimatedUsd)
    const usdValid = Number.isFinite(usd) && usd >= 0
    checks.push(
      check(
        'notional-parseable',
        'Notional is a real number',
        usdValid,
        usdValid ? `$${usd.toFixed(2)}` : 'Notional could not be read as a number.'
      )
    )

    checks.push(
      check(
        'per-action-cap',
        'Per-action cap',
        usdValid && usd <= policy.maxNotionalUsdPerAction,
        `$${usdValid ? usd.toFixed(2) : '?'} against a $${policy.maxNotionalUsdPerAction.toFixed(2)} cap.`
      )
    )

    const projectedDeploy = ctx.missionDeployedUsd + (usdValid ? usd : Number.POSITIVE_INFINITY)
    checks.push(
      check(
        'capital-cap',
        'Mission capital cap',
        projectedDeploy <= policy.maxNotionalUsdPerMission,
        `$${projectedDeploy.toFixed(2)} deployed after this, cap is $${policy.maxNotionalUsdPerMission.toFixed(2)}.`
      )
    )

    checks.push(
      check(
        'max-loss',
        'Max loss not breached',
        ctx.missionRealisedUsd > -policy.maxLossUsd,
        `Realised $${ctx.missionRealisedUsd.toFixed(2)} against a -$${policy.maxLossUsd.toFixed(2)} floor.`
      )
    )

    // --- Amounts -----------------------------------------------------------
    const amountStr = action.kind === 'transfer' ? action.amount : action.sellAmount
    const amount = Number(amountStr)
    checks.push(
      check(
        'amount-positive',
        'Amount is positive',
        Number.isFinite(amount) && amount > 0,
        Number.isFinite(amount) ? `${amountStr}` : `Amount "${amountStr}" is not a number.`
      )
    )

    // --- Kind-specific rules ----------------------------------------------
    if (action.kind === 'transfer') {
      const allowlisted = policy.transferAllowlist.some(
        (addr) => addr.trim().toLowerCase() === action.to.trim().toLowerCase()
      )
      checks.push(
        check(
          'transfer-allowlist',
          'Destination allowlisted',
          allowlisted,
          policy.transferAllowlist.length === 0
            ? 'Transfer allowlist is empty, so no destination is permitted.'
            : allowlisted
              ? `${action.to} is on the allowlist.`
              : `${action.to} is not on the transfer allowlist.`
        )
      )

      const symbolOk = policy.tokenAllowlist.includes(action.symbol.toUpperCase())
      checks.push(
        check(
          'transfer-token',
          'Asset allowlisted',
          symbolOk,
          symbolOk ? `${action.symbol} is permitted.` : `${action.symbol} is not on the token allowlist.`
        )
      )
    } else {
      const sellOk = policy.tokenAllowlist.includes(action.sellSymbol.toUpperCase())
      const buyOk = policy.tokenAllowlist.includes(action.buySymbol.toUpperCase())
      checks.push(
        check(
          'swap-tokens',
          'Both legs allowlisted',
          sellOk && buyOk,
          sellOk && buyOk
            ? `${action.sellSymbol} → ${action.buySymbol} permitted.`
            : `Not permitted: ${[!sellOk && action.sellSymbol, !buyOk && action.buySymbol]
                .filter(Boolean)
                .join(', ')}.`
        )
      )

      const slippageOk =
        Number.isFinite(action.slippageBps) &&
        action.slippageBps >= 0 &&
        action.slippageBps <= policy.maxSlippageBps
      checks.push(
        check(
          'slippage-cap',
          'Slippage within tolerance',
          slippageOk,
          `${action.slippageBps} bps against a ${policy.maxSlippageBps} bps cap.`
        )
      )

      const expected = Number(action.expectedBuyAmount)
      checks.push(
        check(
          'quote-present',
          'Quote is usable',
          Number.isFinite(expected) && expected > 0,
          Number.isFinite(expected) && expected > 0
            ? `Expecting ${action.expectedBuyAmount} ${action.buySymbol}.`
            : 'No usable quote for the buy leg.'
        )
      )
    }
  } catch (err) {
    // An exception anywhere above means we could not finish judging this
    // action, and an unjudged action is never allowed to proceed.
    return {
      decision: 'block',
      checks: [
        ...checks,
        check(
          'gate-integrity',
          'Gate completed',
          false,
          `Gate threw while evaluating: ${err instanceof Error ? err.message : String(err)}`
        )
      ],
      reason: 'The safety gate could not finish evaluating this action, so it was refused.',
      evaluatedAt: Date.now()
    }
  }

  const failed = checks.find((c) => !c.passed)
  if (failed) {
    return {
      decision: 'block',
      checks,
      reason: `${failed.label}: ${failed.detail}`,
      evaluatedAt: Date.now()
    }
  }

  const modeInfo = EXECUTION_MODES.find((m) => m.id === ctx.mode)
  // An unrecognised mode is treated as the strictest one.
  const requiresApproval = modeInfo ? modeInfo.requiresApproval : true

  return {
    decision: requiresApproval ? 'needs-approval' : 'allow',
    checks,
    reason: null,
    evaluatedAt: Date.now()
  }
}
