import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('public'),prefix='/university-future-requests/';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webp':'image/webp','.ics':'text/calendar; charset=utf-8'};
http.createServer((req,res)=>{const url=new URL(req.url,'http://localhost');if(url.pathname==='/'){res.writeHead(302,{Location:prefix});res.end();return;}if(!url.pathname.startsWith(prefix)){res.writeHead(404);res.end();return;}let file;try{file=path.resolve(root,decodeURIComponent(url.pathname.slice(prefix.length))||'index.html');}catch{res.writeHead(400);res.end();return;}
 if(file!==root&&!file.startsWith(root+path.sep)){res.writeHead(403);res.end();return;}if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});fs.createReadStream(file).pipe(res);
}).listen(4173,'127.0.0.1',()=>console.log('Локальный просмотр: http://127.0.0.1:4173'+prefix));
