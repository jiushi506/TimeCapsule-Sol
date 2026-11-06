import assert from 'node:assert/strict';
import test from 'node:test';
import { PublicKey } from '@solana/web3.js';
import type { PhantomSolanaProvider } from '../../context/solanaWalletUtils';
import { cancelSolanaUpload, createSolanaSealQuote, deriveSolanaCapsulePda, getPendingSolanaUpload, reconcileCompletedSolanaUpload,
  SOLANA_PROGRAM_ID, SOLANA_SAFE_RECORD_BYTES, SOLANA_UPLOAD_DRAFT_KEY, type SolanaUploadDraft } from '../solanaCapsuleService';

const owner = new PublicKey(new Uint8Array(32).fill(7));
function draft(): SolanaUploadDraft {
  return {schemaVersion:1,cluster:'devnet',programId:SOLANA_PROGRAM_ID,owner:owner.toBase58(),capsuleId:'1',
    capsulePda:deriveSolanaCapsulePda(owner.toBase58(),'1').toBase58(),mode:'private',formatVersion:1,
    unlockAt:1_900_000_000,payloadHash:`0x${'11'.repeat(32)}`,payloadBase64:'AA==',publicTitle:'',updatedAt:1,
    pendingSignature:'2'.repeat(88),pendingLastValidBlockHeight:200,pendingPhase:'begin'};
}

test('cancellation preserves an unknown in-flight transaction and never opens the wallet', async () => {
  const saved = draft(), storage = new Map([[SOLANA_UPLOAD_DRAFT_KEY,JSON.stringify(saved)]]);
  const priorStorage = Object.getOwnPropertyDescriptor(globalThis,'localStorage'), priorFetch = globalThis.fetch;
  const methods: string[] = []; let walletCalls=0;
  Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{
    getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key),
  }});
  globalThis.fetch = async (_url,init) => {
    const body=JSON.parse(String(init?.body)); methods.push(body.method);
    const result=body.method==='getSignatureStatuses'?{context:{slot:100},value:[null]}:
      body.method==='getBlockHeight'?100:undefined;
    assert.notEqual(result,undefined,'cancellation must reconcile before reading or closing accounts');
    return new Response(JSON.stringify({jsonrpc:'2.0',id:body.id,result}),{headers:{'content-type':'application/json'}});
  };
  const provider={publicKey:owner,async signTransaction(){walletCalls++;throw new Error('Unexpected wallet request');}} as unknown as PhantomSolanaProvider;
  try {
    await assert.rejects(()=>cancelSolanaUpload(saved.owner,saved.capsulePda,provider),/No new wallet request was sent/);
    assert.deepEqual(methods,['getSignatureStatuses','getBlockHeight']);
    assert.equal(walletCalls,0);
    assert.deepEqual(getPendingSolanaUpload(),saved);
  } finally {
    globalThis.fetch=priorFetch;
    if(priorStorage)Object.defineProperty(globalThis,'localStorage',priorStorage);else Reflect.deleteProperty(globalThis,'localStorage');
  }
});

test('completed-upload recovery refuses a different program or PDA before any RPC call', async () => {
  const saved=draft();
  await assert.rejects(()=>reconcileCompletedSolanaUpload({...saved,programId:owner.toBase58()}),/does not match/);
  await assert.rejects(()=>reconcileCompletedSolanaUpload({...saved,capsulePda:owner.toBase58()}),/does not match/);
});

test('records above the current program heap limit are rejected before any RPC or wallet request', async () => {
  const priorFetch = globalThis.fetch; let calls = 0;
  globalThis.fetch = async (_url, init) => {
    calls++;
    const body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: body.id, error: { code: -32000, message: 'RPC reached' } }), { headers: { 'content-type': 'application/json' } });
  };
  const quote = (bytes: number, mode: 'private' | 'public' = 'private', publicTitle?: string) => createSolanaSealQuote({
    owner: owner.toBase58(), payloadBytes: new Uint8Array(bytes).fill(1), mode, publicTitle, unlockAt: 1_900_000_000 });
  try {
    await assert.rejects(() => quote(SOLANA_SAFE_RECORD_BYTES + 1), /supports up to 8,192 bytes/);
    await assert.rejects(() => quote(SOLANA_SAFE_RECORD_BYTES - 10, 'public', 'a'.repeat(11)), /supports up to 8,192 bytes/);
    assert.equal(calls, 0);
    await assert.rejects(() => quote(SOLANA_SAFE_RECORD_BYTES), error => !/supports up to/.test(String(error)));
    assert.ok(calls > 0, 'a record at the limit proceeds to the normal RPC quote');
  } finally { globalThis.fetch = priorFetch; }
});
