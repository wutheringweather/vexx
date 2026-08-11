import { hmac } from '@noble/hashes/hmac'
import { sha512 } from '@noble/hashes/sha512'
import { HDKey } from '@scure/bip32'
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39'
import { wordlist } from '@scure/bip39/wordlists/english'
import { privateKeyToAccount } from 'viem/accounts'
import { Keypair } from '@solana/web3.js'
import { DERIVATION_PATH_EVM, DERIVATION_PATH_SOLANA } from '@shared/constants'

export function createMnemonic(): string {
  // 256 bits -> 24 words.
  return generateMnemonic(wordlist, 256)
}

export function isValidMnemonic(mnemonic: string): boolean {
  return validateMnemonic(mnemonic.trim(), wordlist)
}

export function mnemonicToSeed(mnemonic: string): Uint8Array {
  return mnemonicToSeedSync(mnemonic.trim())
}

// ---------------------------------------------------------------------------
// EVM — BIP32 over secp256k1
// ---------------------------------------------------------------------------

export interface EvmKey {
  privateKeyHex: `0x${string}`
  address: `0x${string}`
  path: string
}

export function deriveEvmKey(seed: Uint8Array, path = DERIVATION_PATH_EVM): EvmKey {
  const node = HDKey.fromMasterSeed(seed).derive(path)
  if (!node.privateKey) throw new Error('EVM derivation produced no private key')
  const privateKeyHex = `0x${Buffer.from(node.privateKey).toString('hex')}` as const
  return {
    privateKeyHex,
    address: privateKeyToAccount(privateKeyHex).address,
    path
  }
}

// ---------------------------------------------------------------------------
// Solana — SLIP-0010 over ed25519
// ---------------------------------------------------------------------------

const ED25519_CURVE = new TextEncoder().encode('ed25519 seed')
const HARDENED_OFFSET = 0x80000000

interface Slip10Node {
  key: Uint8Array
  chainCode: Uint8Array
}

/**
 * ed25519 has no public-key derivation, so SLIP-0010 only defines hardened
 * children. Every segment of the path must therefore carry a `'`.
 */
function slip10Master(seed: Uint8Array): Slip10Node {
  const I = hmac(sha512, ED25519_CURVE, seed)
  return { key: I.slice(0, 32), chainCode: I.slice(32) }
}

function slip10DeriveChild(node: Slip10Node, index: number): Slip10Node {
  const data = new Uint8Array(1 + 32 + 4)
  data[0] = 0x00
  data.set(node.key, 1)
  new DataView(data.buffer).setUint32(33, index >>> 0, false)
  const I = hmac(sha512, node.chainCode, data)
  return { key: I.slice(0, 32), chainCode: I.slice(32) }
}

export function deriveEd25519Seed(seed: Uint8Array, path: string): Uint8Array {
  const segments = path.split('/').slice(1)
  let node = slip10Master(seed)
  for (const segment of segments) {
    if (!segment.endsWith("'")) {
      throw new Error(`SLIP-0010 ed25519 requires hardened segments, got "${segment}"`)
    }
    const index = Number.parseInt(segment.slice(0, -1), 10)
    if (!Number.isInteger(index) || index < 0) {
      throw new Error(`Invalid derivation segment "${segment}"`)
    }
    node = slip10DeriveChild(node, index + HARDENED_OFFSET)
  }
  return node.key
}

export interface SolanaKey {
  secretKey: Uint8Array
  address: string
  path: string
}

export function deriveSolanaKey(seed: Uint8Array, path = DERIVATION_PATH_SOLANA): SolanaKey {
  const keypair = Keypair.fromSeed(deriveEd25519Seed(seed, path))
  return {
    secretKey: keypair.secretKey,
    address: keypair.publicKey.toBase58(),
    path
  }
}
