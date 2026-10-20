# Installed native Digest contract (static)

These findings are from the exact Notes 1.00.261015 and Knowledge 1.00.153
APKs captured on 2026-10-20. They have not yet been proved against a fresh
native-created before/after note pair on this firmware.

## Native creation sequence

- `CreateKnowledgeActivity$4.onClick` checks that `content.trim()` is not
  empty, then inserts the original `content` string. It sends `source_type=2`,
  `source_path=filePath`, `knowledge_base_unique_attribute=selected KB`, and
  Gson `metadata` with `note_page=String(page)`, `note_pageId=pageId`,
  `note_fileId=fileId`, `author=selectedAuthor`. It does not set `source_page`.
  Evidence: private `apk-static-work/Note261015-CreateKnowledgeActivity-4.dexdump.txt`,
  `onClick`, Dalvik offsets 0x16–0x8b.
- It reads the inserted row back by ID, gets `unique_identifier` from its
  metadata JSON and the row's `last_modified_time`, and returns both to the note
  editor. Evidence: same file, `onClick`, offsets 0x8e–0xd8.
- `KnowledgeHelper.addKnowledge` forwards the row fields to
  `content://com.ratta.supernote.knowledge.provider/knowledge/insert`.
  Evidence: private `apk-static-work/Note261015-KnowledgeHelper.dexdump.txt`,
  `addKnowledge`.
- Knowledge provider preserves a `unique_identifier` already present
  in supplied metadata, generating one only when it is absent. Evidence:
  private `apk-static-work/Knowledge153-Provider.smali`, lines 3350–3420.
- The note editor creates a textbox operation `0x34` and type 4 with
  `text_digest_data` keys `digest_id` (row UID), `digest_source="1"`, and
  `digest_time` (row last modified millis). Evidence: private
  `apk-static-work/Note261015-DraggableTextBox.smali`, lines 9569–10005 and
  12065–12130.

## Backlink acceptance

Knowledge's source action requires matching file/page IDs and a reachable
type-4 textbox whose embedded `text_digest_data.digest_id` equals the row UID.
If the claimed page lacks it, Knowledge scans other pages for that UID. A row
with correct metadata but no embedded reference fails the existing-target
check. Evidence: private `apk-static-work/Knowledge153-Detail14.smali`, lines
234–335, and `Knowledge153-LinkJumpView.smali`, `getLinkClick`.

## Boundaries

The documented plugin `modifyLassoText` path drops `textDigestData` while
converting SDK TextBox to `JniOperateTrails`; it cannot be assumed to write
this reference. `CreateKnowledgeActivity` is not exported. A direct write of
the `.note` must be tested only on a closed disposable file after decoding the
format changes from a native before/after pair.

## Evidence status at 2026-10-20

- Implemented read proof: `read_references.inspect` finds one reachable Digest
  object in each of three public fixtures and rejects corrupt framing and a
  malformed Digest identity tail. `compare_pair.py` reports current page/tree
  changes without writing.
- Implemented in-memory pointer proof: `append_prototype.py` removes and
  re-adds the exact final Digest object from the public N5 fixture in appended
  revisions. Its current TOTALPATH roundtrips exactly and the original bytes
  remain a prefix. This proves only the block/page/footer pointer mechanics.
- Fresh N6 disposable `textbox-before.note` contains one 875-byte type-100
  text object and no Digest reference. `digest-after.note` preserves the entire
  before file as its prefix but changes current TOTALPATH from one to five
  objects: it modifies the old object by four bytes and adds type-200 objects
  1 and 2, type-100 Digest object 3, and type-0 object 4. It changes `DISABLE`,
  `MAINLAYER`, and `TOTALPATH`; `IDTABLE=0` and `PAGETEXTBOX=1` stay. The native
  donor ID is reachable through object 3. The role of the extra objects and
  changed bitmap is not yet understood.
- The four changed bytes in old object 0 are a little-endian int32 at object
  +311, `0` to `-5`. Disabling the original text is a plausible interpretation,
  not a proved field name. The donor retains the same decoded 51-byte label
  and style tail values but sets operation `0x34` at +315 and text type `4` at
  +319, changes the final CSV field from `none` to Digest identity JSON, and
  adds a roughly 905-byte `TEXTBOX_TRAILS` payload after the CSV. Its geometry
  and `DISABLE` rectangle differ slightly from the original textbox. A
  same-length UID/time rewrite inside this donor is only an offline hypothesis;
  generating new geometry or an invisible anchor has no validated codec.
- The donor also carries a timestamp-like textbox ID, duplicate rects in CSV,
  absolute point coordinates, font/style, original label, and opaque control
  fields. Cloning it into another notebook/page could collide with an object
  ID or place visible text over content; changing its label/geometry could
  invalidate the nested trails or bitmap. The documented TextBox/insertText
  model exposes no hidden/opacity primitive and requires nonempty text,
  positive font size and a nonzero rectangle. A generic, invisible anchor is
  therefore unproved, even though this exact donor worked on its own page.
- CSV field 3 is a 20-digit decimal textbox ID whose first 14 digits match a
  `yyyyMMddHHmmss` timestamp. The old textbox's base64-encoded ID also occurs
  once inside the donor's nested `TEXTBOX_TRAILS`, while the donor's new ID
  occurs in its main CSV. This shows the donor trails retain a reference to
  the source textbox; a cross-file/page clone cannot assume independent
  validity. More precisely, the nested payload contains the entire original
  875-byte plain textbox object byte-for-byte at donor offset +1016. The
  native after-copy's separate top-level old object is changed at +311 to
  int32 `-5`; the nested snapshot remains the pre-change bytes. The remaining
  six ID digits and uniqueness rules are unknown.
- `create_exact_donor_candidate.py` appended only native object 3 to the
  text-only copy in a private output. The result preserves all 51,315 original
  bytes, old object 0, and layer pointers, and the read-only parser finds one
  matching UID. Luna verified the existing native Digest row's Source action
  opened the owned notebook page, and the file after Source navigation was
  byte-identical to the candidate. A subsequent native edit/save kept both
  existing TOTALPATH objects byte-identical and the same UID reachable, while
  appending a third text object and changing the bitmap/`DISABLE` pointers.
  This proves just this exact copied donor with its existing provider row. It
  cannot establish an arbitrary UID writer or invisible metadata-only anchor.
- A separate candidate changed only one hex digit of the exact donor's
  base64-encoded `digest_id`, keeping its length, timestamp, geometry and
  nested trails. Luna's native Source action then showed “The link target
  doesn't exist. Delete the link?” and did not jump. The prompt was canceled
  and the positive after-save note restored. This is a causal check that the
  current reachable embedded UID matters; stale positive bytes in the
  append-only prefix did not satisfy Knowledge's lookup.
- A third private candidate converts the existing plain textbox itself by
  changing observed operation `0x1e` to `0x34`, text type `1` to `4`, and the
  terminal CSV field `none` to the exact native donor JSON, with framing
  lengths adjusted. It retains original geometry, label, control data, short
  suffix and bitmap pointers, and adds no `TEXTBOX_TRAILS`. Offline parsing
  sees the UID, but Luna's native Source action showed the missing-target
  prompt. Static comparison then found another native field: base64 CSV field
  13 begins `0,0,0,...` for plain text and `4,0,0,...` for the native Digest.
  A new fixed private candidate changes just this scalar to 4 on top of the
  converted candidate, preserving field/object lengths. Luna verified the
  native Source action opened the owned page with this style-type4 candidate;
  the file stayed byte-identical after Source. Its save survival is pending.
  Thus nested `TEXTBOX_TRAILS` is unnecessary for this Source navigation on
  the original page; that does not establish a general object codec.
- A separate fixed private blank-page candidate appends that exact accepted
  999-byte type-4 object to the original 2,704-byte blank note, changes only
  `TOTALPATH` and `PAGETEXTBOX` (`0` to `1`), and preserves `DISABLE=none` and
  all blank bitmap/layer pointers. Offline parsing finds the same UID. Native
  appearance, Source navigation and save survival remain untested.

## Proposed production transaction, pending native proof

1. Generate one UID and durable journal entry. Reject a preexisting provider
   row or live reference with that UID unless it can be reconciled exactly.
2. Require pinned Notes/Knowledge versions, recognized `.note` format, same
   `FILE_ID`, `PAGEID`, page order and target page, and a closed Notes file via
   FileStateProvider. Capture source SHA-256 and mtime. A state query is not an
   exclusive reservation, so controlled device quiescence is still required.
3. Build a new candidate from a native-proved object operation. Preserve the
   entire source as the candidate prefix; append only the necessary current
   TOTALPATH, page metadata, footer and tail. All original bitmap bytes and
   layer pointers must remain byte-identical. The candidate changes only the
   proved object(s) and necessary offsets. Verify parser readback, exactly one
   new UID, all other references, format/header identity and untouched pages.
4. Recheck closed state, source SHA-256 and mtime immediately before commit;
   stage, sync and atomically replace within the same filesystem, retaining an
   exact backup. Re-read the committed bytes. Do not treat an uncertain commit
   result as permission to retry without reading back file and provider state.
5. Choose a positive last-modified timestamp before building the candidate;
   embed it as `digest_time` and supply the same `last_modified_time` on row
   insert. The provider accepts a positive caller timestamp in this installed
   version. Knowledge's source-click method checks only the UID, but other
   timestamp uses have not been excluded. Insert the row with the same UID in
   `metadata.unique_identifier`, `source_type=2`, exact source path and native
   NOTE metadata. Query by UID and verify row fields, source identity and
   timestamp. If insertion fails,
   the orphan embedded reference has no Knowledge row; recovery must inspect
   both resources before any compensation or retry. Inserting the row before
   the note commit would expose a broken source action on failure.

No production writer, device mutation, or provider insertion follows from
this proposal. Controlled candidate proof, arbitrary UID codec proof, and
race assessment are required first. The exact native donor does not prove
that an arbitrary tiny or invisible textbox is safe to create.
