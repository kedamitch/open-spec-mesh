# C03-02 scoped digest vectors

- `c03-02-contract-digest.txt` preserves the pre-replan vector from commit `f865c821cbc83acc7fcdabf312592c652a6a3af6`. Recomputing the canonical documents at that commit yields `b20c1e28363d50cff7ccb6ef4358fa9b26b0d17a436b75d2d7f5874ca79b8e66`.
- `c03-02-replanned-contract-digest.txt` is the frozen attempt-4 vector for the current canonical documents.
- `c03-02-contract-no-path.md` is an independent complete Task fixture without a Path Contract; tests verify that scoped hashing remains stable when its document inputs use CRLF.

The historical vector is retained as-is; replanning creates a separate current vector rather than rewriting legacy evidence.
