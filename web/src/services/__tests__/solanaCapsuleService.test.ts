import assert from 'node:assert/strict';
import test from 'node:test';
import { PublicKey } from '@solana/web3.js';
import { getBase58Decoder } from '@solana/kit';
import { hasProgramInstructionForCapsule, SOLANA_PROGRAM_ID } from '../solanaCapsuleService';

const capsulePda = new PublicKey(new Uint8Array(32).fill(7)).toBase58();
const otherProgram = new PublicKey(new Uint8Array(32).fill(8)).toBase58();

const accountKeys = [SOLANA_PROGRAM_ID, capsulePda, otherProgram];
const finalizeDiscriminator = Uint8Array.from([169, 40, 217, 191, 161, 145, 42, 218]);
const finalizeData = getBase58Decoder().decode(Uint8Array.from([...finalizeDiscriminator, 0]));
const unrelatedData = getBase58Decoder().decode(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]));
const instructions = [
  { programIdIndex: 0, accountKeyIndexes: [1], data: finalizeData },
  { programIdIndex: 2, accountKeyIndexes: [1], data: finalizeData },
];

test('indexed Solana observation binds the matching CapsuleFinalized event to its exact top-level instruction', () => {
  assert.equal(hasProgramInstructionForCapsule(accountKeys, instructions, capsulePda, finalizeDiscriminator, 0), true);
  assert.equal(hasProgramInstructionForCapsule(accountKeys, instructions, capsulePda, finalizeDiscriminator, 1), false);
  assert.equal(hasProgramInstructionForCapsule(accountKeys, instructions, capsulePda, finalizeDiscriminator, 2), false);
  assert.equal(hasProgramInstructionForCapsule(accountKeys, instructions, capsulePda, finalizeDiscriminator, -1), false);
  assert.equal(hasProgramInstructionForCapsule(accountKeys, [{ ...instructions[0]!, data: unrelatedData }], capsulePda, finalizeDiscriminator, 0), false);
});

test('Recovery Card verification still accepts any matching top-level TimeCapsule instruction', () => {
  assert.equal(hasProgramInstructionForCapsule(accountKeys, instructions, capsulePda, finalizeDiscriminator), true);
  assert.equal(hasProgramInstructionForCapsule(accountKeys, [{ ...instructions[0]!, data: unrelatedData }], capsulePda, finalizeDiscriminator), false);
  assert.equal(hasProgramInstructionForCapsule(accountKeys, [instructions[1]!], capsulePda, finalizeDiscriminator), false);
});
