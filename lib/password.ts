import {randomBytes,scrypt as nodeScrypt,timingSafeEqual,createHash} from 'node:crypto';
const options={N:32768,r:8,p:1,maxmem:64*1024*1024};
function scrypt(password:string,salt:string,length:number,config:typeof options){return new Promise<Buffer>((resolve,reject)=>nodeScrypt(password,salt,length,config,(error,key)=>error?reject(error):resolve(key)));}
export function validPassword(value:unknown):value is string{return typeof value==='string'&&value.length>=12&&value.length<=128;}
export async function hashPassword(password:string){if(!validPassword(password))throw new Error('Лозинката треба да содржи од 12 до 128 знаци.');const salt=randomBytes(16).toString('hex');const hash=await scrypt(password,salt,64,options) as Buffer;return 'scrypt-v1:'+salt+':'+hash.toString('hex');}
export async function verifyPassword(password:unknown,encoded:string){if(typeof password!=='string'||password.length>128)return false;const parts=encoded.split(':');if(parts.length!==3||parts[0]!=='scrypt-v1'||!/^[a-f0-9]{32}$/.test(parts[1])||!/^[a-f0-9]{128}$/.test(parts[2]))return false;const actual=await scrypt(password,parts[1],64,options) as Buffer;return timingSafeEqual(actual,Buffer.from(parts[2],'hex'));}
export function tokenHash(token:string){return createHash('sha256').update(token).digest('hex');}
export function secretMatches(actual:string|null,expected:string|undefined){if(!actual||!expected)return false;return timingSafeEqual(Buffer.from(tokenHash(actual),'hex'),Buffer.from(tokenHash(expected),'hex'));}
