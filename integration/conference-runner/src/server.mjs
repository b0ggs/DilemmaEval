import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';

const defaultSite=fileURLToPath(new URL('../../../conference/site/',import.meta.url));
const assets=new Set(['/','/index.html','/styles.css','/style.css','/app.js','/app.mjs','/state.mjs','/favicon.svg']);
const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
export function createSpectatorServer({getPublicState,siteDirectory=defaultSite}) {
  return createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
    res.setHeader('Cache-Control','no-store');
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,{'Allow':'GET, HEAD'});res.end();return;}
    try {
      const path=new URL(req.url,'http://localhost').pathname;
      if(path==='/api/state'){
        const payload=JSON.stringify(await getPublicState());
        res.writeHead(200,{'Content-Type':'application/json; charset=utf-8'});res.end(req.method==='HEAD'?undefined:payload);return;
      }
      if(!assets.has(path)){res.writeHead(404);res.end('Not found');return;}
      const filename=path==='/'?'index.html':path.slice(1);
      const body=await readFile(resolve(siteDirectory,filename));
      res.writeHead(200,{'Content-Type':mime[extname(filename)]??'application/octet-stream'});res.end(req.method==='HEAD'?undefined:body);
    }catch{res.writeHead(503,{'Content-Type':'application/json'});res.end('{"error":"temporarily-unavailable"}');}
  });
}
