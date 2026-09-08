import {neon} from '@neondatabase/serverless';

// Small parameterized query interface shared by the archive and collector.
// Queries use PostgreSQL syntax. Values are always sent separately from SQL.
function client(){
 const url=process.env.DATABASE_URL;
 if(!url)throw new Error('Базата моментално не е достапна.');
 return neon(url);
}
class Statement {
 constructor(readonly sql:string,readonly params:unknown[]=[]){ }
 bind(...params:unknown[]){return new Statement(this.sql,params);}
 query(){let index=0;const sql=this.sql.replace(/\?/g,()=>'$'+(++index));if(index!==this.params.length)throw new Error('SQL parameter count mismatch');return client().query(sql,this.params);}
 async first<T=Record<string,unknown>>():Promise<T|null>{return ((await this.query())[0] as T)??null;}
 async all<T=Record<string,unknown>>(){return {results:await this.query() as T[]};}
 async run(){return this.query();}
}
export function db(){return {
 prepare:(sql:string)=>new Statement(sql),
 batch:(statements:Statement[])=>client().transaction(statements.map(s=>s.query())),
};}
