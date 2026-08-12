import { describe, expect, it, vi } from 'vitest'
import { Keypair, TransactionMessage, VersionedTransaction } from '@solana/web3.js'
import { executeLiveSwap, formatUnits, parseUnits, quoteTargetBuy } from './jupiter'

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  })
}

describe('Jupiter live swap adapter', () => {
  it('uses exact decimal arithmetic for token base units', () => {
    expect(parseUnits('1.25', 6)).toBe(1_250_000n)
    expect(formatUnits(1_250_000n, 6)).toBe('1.25')
    expect(formatUnits('1000000000', 9)).toBe('1')
  })

  it('increases an ExactIn quote until the requested target is guaranteed', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes('coinbase.com') && url.includes('USDC-USD')) return response({ data: { amount: '1' } })
      if (url.includes('coinbase.com') && url.includes('SOL-USD')) return response({ data: { amount: '150' } })
      const attempt = fetchMock.mock.calls.filter(([called]) => String(called).includes('api.jup.ag')).length
      return response(
        attempt === 1
          ? {
              inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
              outputMint: 'So11111111111111111111111111111111111111112',
              inAmount: '151500000',
              outAmount: '950000000',
              otherAmountThreshold: '940000000',
              requestId: 'r1'
            }
          : {
              inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
              outputMint: 'So11111111111111111111111111111111111111112',
              inAmount: '161000000',
              outAmount: '1050000000',
              otherAmountThreshold: '1020000000',
              requestId: 'r2',
              router: 'jupiter'
            }
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const quote = await quoteTargetBuy('test-key', {
      sellSymbol: 'USDC',
      buySymbol: 'SOL',
      targetBuyAmount: '1',
      slippageBps: 100,
      taker: Keypair.generate().publicKey.toBase58()
    })

    expect(quote.sellAmount).toBe('161')
    expect(quote.expectedBuyAmount).toBe('1.05')
    expect(quote.minimumOutputAmountRaw).toBe('1020000000')
    expect(fetchMock).toHaveBeenCalledTimes(4) // two prices + two Jupiter orders
  })

  it('refuses to sign when the fresh minimum output misses the target', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (!url.includes('api.jup.ag')) throw new Error('unexpected price call')
      return response({
        inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        outputMint: 'So11111111111111111111111111111111111111112',
        inAmount: '1000000',
        outAmount: '950000000',
        otherAmountThreshold: '980000000',
        transaction: 'this must not be read',
        requestId: 'stale'
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeLiveSwap('test-key', {
      sellSymbol: 'USDC',
      buySymbol: 'SOL',
      targetBuyAmount: '1',
      sellAmount: '1',
      slippageBps: 100,
      taker: Keypair.generate().publicKey.toBase58(),
      secretKey: Keypair.generate().secretKey
    })

    expect(result.ok).toBe(false)
    expect(result.signature).toBeNull()
    expect(result.detail).toContain('nothing was signed')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('signs the fresh versioned order and hands it to Jupiter execute', async () => {
    const signer = Keypair.generate()
    const orderTx = new VersionedTransaction(
      new TransactionMessage({
        payerKey: signer.publicKey,
        recentBlockhash: Keypair.generate().publicKey.toBase58(),
        instructions: []
      }).compileToV0Message()
    )
    const encoded = Buffer.from(orderTx.serialize()).toString('base64')
    const executeBodies: Record<string, unknown>[] = []
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/order')) {
        return response({
          inputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          outputMint: 'So11111111111111111111111111111111111111112',
          inAmount: '1000000',
          outAmount: '1000000000',
          otherAmountThreshold: '1000000000',
          transaction: encoded,
          requestId: 'execute-me'
        })
      }
      executeBodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return response({
        status: 'Success',
        signature: 'real-signature',
        inputAmountResult: '1000000',
        outputAmountResult: '1000000000'
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await executeLiveSwap('test-key', {
      sellSymbol: 'USDC',
      buySymbol: 'SOL',
      targetBuyAmount: '1',
      sellAmount: '1',
      slippageBps: 100,
      taker: signer.publicKey.toBase58(),
      secretKey: signer.secretKey
    })

    expect(result).toMatchObject({ ok: true, signature: 'real-signature', actualBuyAmount: '1' })
    expect(executeBodies[0]?.requestId).toBe('execute-me')
    expect(String(executeBodies[0]?.signedTransaction).length).toBeGreaterThan(20)
  })
})
