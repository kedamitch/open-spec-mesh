"""Fixture for deployment-contract verification; not a shipped business service."""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import os
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path != '/health': self.send_error(404); return
        body=json.dumps({'message':os.environ['TEST_MESSAGE'],'literal':os.environ['LITERAL']}).encode()
        self.send_response(200);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(body)
    def log_message(self,*args): pass
if __name__=='__main__':HTTPServer(('0.0.0.0',8080),Handler).serve_forever()
