import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction
} from '@solana/web3.js'
import type { BalanceInfo, NetworkInfo } from '@shared/types'
import { requireSolanaKey } from '../vault/keystore'

function connectionFor(network: NetworkInfo): Connection {
  return new Connection(network.rpcUrl, 'confirmed')
}

export async function getBalance(network: NetworkInfo, address: string): Promise<BalanceInfo> {
  const base: Omit<BalanceInfo, 'raw' | 'formatted' | 'error'> = {
    networkId: network.id,
    address,
    symbol: network.nativeSymbol,
    decimals: network.decimals,
    fetchedAt: Date.now()
  }
  try {
    const lamports = await connectionFor(network).getBalance(new PublicKey(address))
    return {
      ...base,
      raw: lamports.toString(),
      formatted: (lamports / LAMPORTS_PER_SOL).toFixed(6)
    }
  } catch (err) {
    return {
      ...base,
      raw: '0',
      formatted: '0.000000',
      error: err instanceof Error ? err.message : 'RPC unreachable'
    }
  }
}

export interface SolanaSendResult {
  txHash: string
  explorerUrl: string
}

export async function sendNative(
  network: NetworkInfo,
  to: string,
  amountSol: string
): Promise<SolanaSendResult> {
  const key = requireSolanaKey()
  const payer = Keypair.fromSecretKey(key.secretKey)
  const connection = connectionFor(network)

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: new PublicKey(to),
      lamports: Math.round(Number(amountSol) * LAMPORTS_PER_SOL)
    })
  )
  const signature = await sendAndConfirmTransaction(connection, tx, [payer])
  const cluster = network.isMainnet ? '' : '?cluster=devnet'
  return { txHash: signature, explorerUrl: `${network.explorerTxUrl}${signature}${cluster}` }
}

export async function simulateNative(
  network: NetworkInfo,
  from: string,
  to: string,
  amountSol: string
): Promise<{ ok: boolean; detail: string; feeLamports: number | null }> {
  try {
    const connection = connectionFor(network)
    const fromKey = new PublicKey(from)
    const lamports = Math.round(Number(amountSol) * LAMPORTS_PER_SOL)

    const tx = new Transaction().add(
      SystemProgram.transfer({ fromPubkey: fromKey, toPubkey: new PublicKey(to), lamports })
    )
    tx.feePayer = fromKey
    tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash

    const [balance, feeResponse] = await Promise.all([
      connection.getBalance(fromKey),
      connection.getFeeForMessage(tx.compileMessage())
    ])
    const fee = feeResponse.value ?? 5000

    if (balance < lamports + fee) {
      return {
        ok: false,
        detail: `Insufficient balance: holds ${(balance / LAMPORTS_PER_SOL).toFixed(6)} SOL, needs ${(
          (lamports + fee) /
          LAMPORTS_PER_SOL
        ).toFixed(6)} SOL including fee.`,
        feeLamports: fee
      }
    }
    return {
      ok: true,
      detail: `Simulated on ${network.label}. Fee ${(fee / LAMPORTS_PER_SOL).toFixed(6)} SOL.`,
      feeLamports: fee
    }
  } catch (err) {
    return {
      ok: false,
      detail: err instanceof Error ? err.message : 'Simulation failed',
      feeLamports: null
    }
  }
}

export function isValidAddress(address: string): boolean {
  try {
    // Rejects both bad base58 and valid base58 that is not on the curve.
    new PublicKey(address.trim())
    return true
  } catch {
    return false
  }
}

export async function requestAirdrop(network: NetworkInfo, address: string): Promise<string> {
  if (network.isMainnet) throw new Error('Airdrops only exist on devnet.')
  const connection = connectionFor(network)
  const signature = await connection.requestAirdrop(new PublicKey(address), LAMPORTS_PER_SOL)
  await connection.confirmTransaction(signature, 'confirmed')
  return signature
}
