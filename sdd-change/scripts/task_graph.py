#!/usr/bin/env python3
"""Validate optional Task dependencies; state writes are primary-only policy."""
import argparse,json
from pathlib import Path
import re
STATES={"planned","running","submitted","accepted","blocked"}
FIELDS={"id","depends_on","state","result_revision","path","history","contract_digest","report_digest","workspace","baseline","attempt","agent_session"}

def load_graph(path):
    def unique_fields(pairs):
        result={}
        for key,value in pairs:
            if key in result: raise ValueError(f"Duplicate JSON field: {key}")
            result[key]=value
        return result
    if path.is_symlink() or not path.is_file(): raise ValueError("Graph must be a regular file.")
    data=json.loads(path.read_text(encoding='utf-8'),object_pairs_hook=unique_fields)
    return data

def validate_graph(data):
    if not isinstance(data,dict) or set(data)!={"tasks"}: raise ValueError("A task graph contains only a tasks array.")
    tasks=data['tasks']
    if not isinstance(tasks,list) or not tasks: raise ValueError("Use a non-empty tasks array, or omit the graph.")
    by_id={}
    for task in tasks:
        if not isinstance(task,dict) or set(task)-FIELDS: raise ValueError("Invalid task fields.")
        if not {'id','depends_on','state'}<=set(task): raise ValueError("Task requires id, depends_on and state.")
        task_id=task['id']
        if not isinstance(task_id,str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]*',task_id): raise ValueError("Invalid task id.")
        if task_id in by_id: raise ValueError(f"Duplicate task id: {task_id}")
        if 'path' in task and (not isinstance(task['path'],str) or not task['path'] or Path(task['path']).is_absolute() or '..' in Path(task['path']).parts): raise ValueError(f'{task_id}: invalid relative task path.')
        if 'history' in task and (not isinstance(task['history'],list) or any(not isinstance(e,dict) or e.get('state') not in STATES for e in task['history'])): raise ValueError(f'{task_id}: invalid history.')
        for field in ('contract_digest','report_digest','baseline','workspace','agent_session'):
            if field in task and (not isinstance(task[field],str) or not task[field].strip()): raise ValueError(f'{task_id}: invalid {field}.')
        if 'agent_session' in task and (len(task['agent_session']) > 256 or any(ord(ch) < 32 for ch in task['agent_session'])): raise ValueError(f'{task_id}: invalid agent_session.')
        if not isinstance(task['state'],str) or task['state'] not in STATES: raise ValueError(f'{task_id}: invalid state.')
        if 'attempt' in task and (type(task['attempt']) is not int or task['attempt'] < 1): raise ValueError(f'{task_id}: invalid attempt.')
        deps=task['depends_on']
        if not isinstance(deps,list) or any(not isinstance(dep,str) for dep in deps): raise ValueError(f'{task_id}: dependencies must be task ids.')
        if len(set(deps))!=len(deps): raise ValueError(f'{task_id}: duplicate dependency.')
        revision=task.get('result_revision')
        if 'result_revision' in task and (not isinstance(revision,str) or not revision.strip()): raise ValueError(f'{task_id}: result_revision must identify a concrete result.')
        if task['state'] in {'submitted','accepted'} and not revision: raise ValueError(f'{task_id}: submitted/accepted requires result_revision.')
        by_id[task_id]=task
    for task in tasks:
        for dep in task['depends_on']:
            if dep not in by_id or dep==task['id']: raise ValueError(f"{task['id']}: unknown or self dependency {dep}.")
    remaining={k:len(t['depends_on']) for k,t in by_id.items()}; children={k:[] for k in by_id}
    for key,task in by_id.items():
        for dep in task['depends_on']: children[dep].append(key)
    queue=[k for k,c in remaining.items() if c==0]; visited=0
    while queue:
        key=queue.pop(); visited+=1
        for child in children[key]:
            remaining[child]-=1
            if remaining[child]==0: queue.append(child)
    if visited!=len(tasks): raise ValueError('Task dependencies contain a cycle.')
    ready,active,blocked=[],[],{}
    for task in tasks:
        key,state=task['id'],task['state']; waiting=[dep for dep in task['depends_on'] if by_id[dep]['state']!='accepted']
        if state in {'running','submitted','accepted'} and waiting: raise ValueError(f'{key}: dependencies must be accepted before execution.')
        if state=='blocked': blocked[key]='state=blocked'
        elif waiting: blocked[key]='waiting_for_dependencies: '+', '.join(waiting)
        elif state=='planned': ready.append(key)
        elif state in {'running','submitted'}: active.append(key)
    return {'ready':ready,'active':active,'blocked':blocked}

def main():
    import sys
    sys.path.insert(0,str(Path(__file__).resolve().parents[2]/'sdd-init/scripts'))
    parser=argparse.ArgumentParser(description=__doc__); parser.add_argument('graph',nargs='?',type=Path); parser.add_argument('--root',default=str(Path.cwd())); parser.add_argument('--change'); parser.add_argument('--task'); parser.add_argument('--action',choices=['approve','submit','block','rework','replan']); parser.add_argument('--reason',default=''); parser.add_argument('--workers-stopped',action='store_true'); parser.add_argument('--user-confirmed',action='store_true'); args=parser.parse_args()
    try:
        if args.action:
            from sdd_common import root_path
            from numbering import locked
            from workflow import transition
            root=root_path(args.root)
            if not args.change or not args.task: raise ValueError('--change and --task required')
            with locked(root): print(transition(root,args.change,args.task,args.action,args.reason,workers_stopped=args.workers_stopped,user_confirmed=args.user_confirmed))
        else:
            if args.graph is None: raise ValueError('Graph path required')
            print(json.dumps(validate_graph(load_graph(args.graph)),indent=2))
    except (OSError,ValueError) as exc: parser.exit(1,f'{exc}\n')
if __name__=='__main__': main()
