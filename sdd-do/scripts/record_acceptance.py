"""Primary accepts an unchanged submitted report or records consolidated rework."""
import argparse,hashlib
from pathlib import Path
import sys
PACKAGE=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(PACKAGE/'sdd-init/scripts'),str(PACKAGE/'sdd-change/scripts')]
from sdd_common import root_path,read_text
from numbering import locked
from workflow import context,document,contract_digest,event,save_graph,transition
from delivery_evidence import acceptance_blockers

def accept(root,change_id,task_id,decision,reason,workers_stopped=False):
    if decision not in ('accept','rework'): raise ValueError('Unknown acceptance decision')
    if not reason.strip(): raise ValueError('Acceptance evidence/feedback required')
    with locked(root):
        if decision=='rework': return transition(root,change_id,task_id,'rework',reason,workers_stopped=workers_stopped)
        change,fields,gp,g,t,d,tf=context(root,change_id,task_id); report=read_text(document(root,d,tf,'report'))
        if t['state']!='submitted' or hashlib.sha256(report.encode()).hexdigest()!=t.get('report_digest'): raise ValueError('Submit the current report before acceptance')
        if contract_digest(root,change,fields,d,tf)!=t.get('contract_digest'): raise ValueError('Frozen Contract changed')
        task_contract=read_text(document(root,d,tf,'contract'))
        blockers=acceptance_blockers(report,task_contract)
        if blockers: raise ValueError('Delivery is not acceptance-ready: '+', '.join(blockers))
        event(t,'accepted',reason=reason,revision=t['result_revision']); save_graph(gp,g); return 'accepted'

def main():
    p=argparse.ArgumentParser(description=__doc__); p.add_argument('change_id'); p.add_argument('task_id'); p.add_argument('decision',choices=['accept','rework']); p.add_argument('--reason',required=True); p.add_argument('--workers-stopped',action='store_true'); p.add_argument('--root',default=str(Path.cwd())); a=p.parse_args()
    try: print(accept(root_path(a.root),a.change_id,a.task_id,a.decision,a.reason,a.workers_stopped))
    except (OSError,ValueError) as e: p.exit(1,str(e)+'\n')
if __name__=='__main__': main()
