import test from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,verifyPassword,validPassword,tokenHash,secretMatches} from '../lib/password.ts';
test('password hashes are salted and verify only the correct password',async()=>{const p='A test password with enough length';const a=await hashPassword(p),b=await hashPassword(p);assert.notEqual(a,b);assert.equal(await verifyPassword(p,a),true);assert.equal(await verifyPassword(p+'x',a),false);assert.equal(await verifyPassword(p,'invalid'),false);});
test('password policy and server secret validation fail closed',()=>{assert.equal(validPassword('short'),false);assert.equal(validPassword('x'.repeat(129)),false);assert.equal(secretMatches(null,undefined),false);assert.equal(secretMatches('Bearer correct','Bearer correct'),true);assert.equal(secretMatches('Bearer incorrect','Bearer correct'),false);assert.equal(tokenHash('token').length,64);});
