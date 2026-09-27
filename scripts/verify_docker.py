"""Build and run a disposable test fixture, never a production application."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request

ROOT=Path(__file__).resolve().parents[1]
def run(*args):
    return subprocess.check_output(['docker',*args],text=True).strip()

def main():
    if not shutil.which('docker'): raise SystemExit('Docker is required; this validation has NOT run')
    run('info','--format','{{.ServerVersion}}')
    image=f'sdd-env-smoke:{os.getpid()}'
    container=None
    with tempfile.TemporaryDirectory(prefix='sdd-docker-') as directory:
        context=Path(directory)/'context'
        shutil.copytree(ROOT/'tests/fixtures/docker-app',context)
        env=context/'.env';env.write_text('TEST_MESSAGE=sdd-smoke-ok\nLITERAL=$NOT_EXPANDED\n');env.chmod(0o600)
        try:
            subprocess.run(['docker','build','-t',image,str(context)],check=True,timeout=300)
            container=run('run','-d','--env-file',str(env),'-p','127.0.0.1::8080',image)
            port=run('port',container,'8080/tcp').rsplit(':',1)[-1]
            for _ in range(40):
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/health',timeout=2) as response:
                        data=json.load(response)
                    assert data=={'message':'sdd-smoke-ok','literal':'$NOT_EXPANDED'},data
                    break
                except (OSError,ValueError): time.sleep(0.5)
            else: raise RuntimeError('Health endpoint never became ready')
            assert run('inspect','--format','{{.Config.User}}',container) not in ('','root','0')
            run('exec',container,'test','!','-e','/app/.env')
            assert 'sdd-smoke-ok' not in run('logs',container)
            run('restart',container)
            print('Docker build, --env-file, literal values, non-root, secret exclusion and restart: passed')
        finally:
            if container: subprocess.run(['docker','rm','-f',container],check=False)
            subprocess.run(['docker','image','rm','-f',image],check=False,stdout=subprocess.DEVNULL)
if __name__=='__main__':main()
