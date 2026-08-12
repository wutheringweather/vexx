import { beforeAll, describe, expect, it, vi } from 'vitest'
import * as state from '../state'
import * as keystore from '../vault/keystore'
import * as jupiter from '../chains/jupiter'
import { runTurn } from './runner'

vi.mock('../storage/secret-store', () => ({
  open: vi.fn(() => 'test-jupiter-key'),
  seal: vi.fn(() => 'cipher')
}))

vi.mock('../chains/jupiter', () => ({
  quoteTargetBuy: vi.fn(async () => ({
    sellSymbol: 'USDC',
    buySymbol: 'SOL',
    sellAmount: '1.5',
    expectedBuyAmount: '1.01',
    targetBuyAmount: '1',
    slippageBps: 100,
    notionalUsd: 1.5,
    source: 'jupiter',
    inputAmountRaw: '1500000',
    outputAmountRaw: '1010000000',
    minimumOutputAmountRaw: '1000000000',
    requestId: 'mock-request',
    router: 'mock'
  })),
  executeLiveSwap: vi.fn(async () => ({
    ok: true,
    signature: 'mock-signature',
    detail: 'Mock Jupiter execution succeeded.',
    actualSellAmount: '151.5',
    actualBuyAmount: '1.01'
  }))
}))

describe('direct buy command pipeline', () => {
  beforeAll(async () => {
    await state.load()
    await keystore.create('Corr3ct-Horse-Battery!')
    await state.update((draft) => {
      draft.policy.mainnetEnabled = true
      draft.mode = 'agent-restricted'
      draft.activeSolanaNetworkId = 'sol-mainnet'
    })
  })

  it('turns buy 1 SOL into a live action waiting for restricted approval', async () => {
    const turn = await runTurn('buy 1 sol', [])
    const record = state.pendingActions()[0]

    expect(turn.actionIds).toHaveLength(1)
    expect(record?.action).toMatchObject({
      kind: 'swap',
      execution: 'live',
      targetBuyAmount: '1',
      sellSymbol: 'USDC',
      buySymbol: 'SOL',
      networkId: 'sol-mainnet'
    })
    expect(record?.status).toBe('pending')
    expect(turn.messages[0]?.content).toContain('Target 1 SOL')
  })

  it('auto-executes the same direct command in full mode after the gate', async () => {
    await state.update((draft) => {
      draft.mode = 'agent-full'
    })
    const turn = await runTurn('buy 1 SOL on mainnet', [])
    const record = state.current().actions.at(-1)

    expect(turn.actionIds).toHaveLength(1)
    expect(record?.status).toBe('executed')
    expect(record?.execution).toMatchObject({ simulated: false, txHash: 'mock-signature' })
    expect(vi.mocked(jupiter.executeLiveSwap)).toHaveBeenCalled()
  })
})
