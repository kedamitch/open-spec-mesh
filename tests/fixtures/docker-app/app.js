import {createServer}from 'node:http';
createServer((req,res)=>{
 if(req.url!=='/health'){res.writeHead(404);res.end();return;}
 res.writeHead(200,{'content-type':'application/json'});
 res.end(JSON.stringify({message:process.env.TEST_MESSAGE,literal:process.env.LITERAL}));
}).listen(8080,'0.0.0.0');
