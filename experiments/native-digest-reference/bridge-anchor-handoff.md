# Bridge anchor contract handoff

The Bridge now has a pure Java `DigestAnchorRequest` and `DigestAnchorBackend`
boundary for a future margin marker write. A request binds the target NOTE
path/page/file ID/page ID to the provider Digest UID and positive
`last_modified_time`. The probe accepts only a single `+` marker, matching the
native short-textbox template; quoted excerpt text is rejected.

This is a contract and validation layer only. It is not called by
`DigestActivity`, does not change provider insert ordering or the SAVED receipt,
and cannot write a `.note` file. The Android-independent tests confirm strict
target, UID, timestamp, and marker validation. Once a native codec is proved,
the owner of the provider flow can supply the UID/time before commit, persist a
pending operation, and delegate the guarded NOTE write through this interface.
An uncertain write must remain uncertain and must not be retried blindly.

Native Source and save/reopen behavior remain a separate device acceptance
gate on the disposable note. This handoff does not authorize or establish a
personal-note writer.
