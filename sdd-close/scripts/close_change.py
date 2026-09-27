"""Archive only after integrated acceptance; restore source on metadata failure."""
import argparse
from pathlib import Path
import sys
PACKAGE=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(PACKAGE/'sdd-init/scripts'),str(PACKAGE/'sdd-change/scripts')]
from sdd_common import active_change,inside,root_path,render_spec,today
from numbering import locked,atomic,refresh
from check_change import check

def close_change(root,change_id):
    with locked(root):
        check(root,change_id); change,fields,body=active_change(root,change_id); destination=inside(root,'docs/05-changes/C02-已完成',change_id); destination.mkdir(); moved=False
        try:
            change.rename(destination); moved=True; fields.update(status='completed',updated=today()); atomic(destination/'index.md',render_spec(fields,body))
        except OSError:
            if moved: destination.rename(change)
            else: destination.rmdir()
            raise
        refresh(change.parent); refresh(destination.parent); return destination

def main():
    p=argparse.ArgumentParser(description=__doc__); p.add_argument('change_id'); p.add_argument('--root',default=str(Path.cwd())); a=p.parse_args()
    try: print(close_change(root_path(a.root),a.change_id))
    except (OSError,ValueError,KeyError) as e: p.exit(1,str(e)+'\n')
if __name__=='__main__': main()
