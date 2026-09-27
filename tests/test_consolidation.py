"""Regression coverage retained from all branches plus new delivery/diagram guarantees."""
from pathlib import Path
import subprocess
import unittest
import test_sdd
import record_delivery
import workflow
from sdd_common import metadata, render_spec
from markdown_contract import split_contract

class ConsolidationTests(unittest.TestCase):
    def setUp(self):
        self.c=test_sdd.LifecycleTest('runTest');self.c.setUp();self.addCleanup(self.c.doCleanups)
    def report(self):
        c=self.c;t=c.task();c.start(t);(c.root/'new.py').write_text('value=1\n')
        sha=c.deliver(t);return t,sha,c.report(t).read_text()
    def test_file_operation_checked(self):
        t,sha,text=self.report();f,body=metadata(text)
        with self.assertRaisesRegex(ValueError,'Incorrect Git operation'):
            record_delivery.deliver(self.c.root,self.c.change.name,t,sha,body.replace('| `new.py` | A |','| `new.py` | M |'),int(f['attempt']))
    def test_missing_file_checked(self):
        t,sha,text=self.report();f,body=metadata(text)
        body='\n'.join(line for line in body.splitlines() if '`new.py`' not in line)
        with self.assertRaisesRegex(ValueError,'File notes must match'):
            record_delivery.deliver(self.c.root,self.c.change.name,t,sha,body,int(f['attempt']))
    def test_extra_file_checked(self):
        t,sha,text=self.report();f,body=metadata(text)
        body=body.replace('## 验证结果','| `imaginary.py` | A | imaginary |\n\n## 验证结果')
        with self.assertRaisesRegex(ValueError,'File notes must match'):
            record_delivery.deliver(self.c.root,self.c.change.name,t,sha,body,int(f['attempt']))
    def test_explicit_stale_attempt_rejected(self):
        t,sha,text=self.report();f,body=metadata(text)
        with self.assertRaisesRegex(ValueError,'Stale assigned attempt'):
            record_delivery.deliver(self.c.root,self.c.change.name,t,sha,body,int(f['attempt'])-1)
    def test_submit_rechecks_files_even_if_report_manually_changed(self):
        t,sha,text=self.report()
        self.c.report(t).write_text(text.replace('`new.py`','`fake.py`'))
        with self.assertRaisesRegex(ValueError,'File notes must match'):
            workflow.transition(self.c.root,self.c.change.name,t,'submit')
        self.assertEqual('running',self.c.info(t)['state'])
    def test_replan_command_supported(self):
        c=self.c;t=c.task();c.start(t);c.accept(t)
        c.change_doc.write_text(c.change_doc.read_text().replace('不改变认证语义', '明确新的认证语义'))
        root=Path(__file__).resolve().parents[1]
        result=subprocess.run(['python3',str(root/'sdd-change/scripts/task_graph.py'),'--root',str(c.root),'--change',c.change.name,'--task',t,'--action','replan','--reason','explicit replan','--user-confirmed'],capture_output=True,text=True)
        self.assertEqual(0,result.returncode,result.stderr);self.assertEqual('planned',c.info(t)['state'])
    def test_explicit_block_has_strict_evidence_sections(self):
        text=self.c.change_doc.read_text().replace('## 最终结论','## Hidden requirement\nNew requirement\n\n## 最终结论')
        with self.assertRaises(ValueError):split_contract(text)
    def test_empty_canonical_graph_cannot_close(self):
        import check_change
        c=self.c;c.verdict()
        with self.assertRaises(ValueError):
            check_change.check(c.root,c.change.name)
    def test_replan_without_user_confirmation_is_nondestructive(self):
        c=self.c;t=c.task();c.start(t);c.accept(t)
        c.change_doc.write_text(c.change_doc.read_text().replace('不改变认证语义','新认证语义'))
        graph=c.ctx(t)[2];before=graph.read_bytes()
        with self.assertRaisesRegex(ValueError,'explicit user confirmation'):
            workflow.transition(c.root,c.change.name,t,'replan','needs decision')
        self.assertEqual(before,graph.read_bytes())
    def test_ordinary_rework_cannot_bypass_confirmation(self):
        c=self.c;t=c.task();c.start(t);c.accept(t)
        c.change_doc.write_text(c.change_doc.read_text().replace('不改变认证语义','新认证语义'))
        with self.assertRaisesRegex(ValueError,'user confirmation'):
            workflow.transition(c.root,c.change.name,t,'rework','bypass')
        workflow.transition(c.root,c.change.name,t,'block','stop affected work')
        with self.assertRaisesRegex(ValueError,'user confirmation'):
            workflow.transition(c.root,c.change.name,t,'rework','blocked bypass')
    def test_unchanged_contract_replan_is_rejected(self):
        c=self.c;t=c.task();c.start(t);c.accept(t)
        with self.assertRaisesRegex(ValueError,'Contract is unchanged'):
            workflow.transition(c.root,c.change.name,t,'replan','not needed',user_confirmed=True)
    def test_required_diagram_scaffolds_exist(self):
        for path in (
            '02-product/P03-diagrams/P03-01-product-architecture.md',
            '02-product/P03-diagrams/P03-02-main-user-flow.md',
            '03-architecture/T05-diagrams/T05-01-system-context.md',
            '03-architecture/T05-diagrams/T05-02-application-architecture.md',
            '03-architecture/T05-diagrams/T05-03-main-sequence.md',
            '03-architecture/T05-diagrams/T05-04-domain-state.md',
            '04-operations/O03-diagrams/O03-01-deployment-architecture.md',
        ):
            self.assertTrue((self.c.root/'docs'/path).is_file(),path)

if __name__=='__main__':unittest.main()
