# Native Digest reference investigation

This parked experiment examines how Supernote Notes records references from a native Digest to a notebook page. The parser reads public fixtures from the sibling Supernote workspace checkouts; those fixtures are not bundled with this plugin repository. The prototype edits fixture bytes in memory. Candidate-writing scripts require disposable evidence stored outside the repository and write only new files under the local ignored `private/` directory.

## Findings

| Probe | Result |
| --- | --- |
| Read reachable Digest references from public fixtures | Parser identifies the page-tree reference and avoids printing Digest IDs or notebook text. |
| Append an exact native type-4 reference object to a disposable candidate | Native Source opened the owned page; the reference survived a native edit/save byte-for-byte. |
| Change the embedded Digest ID | Native Source rejected the candidate as missing its target. |
| Convert a text box into a reference | The minimal conversion was rejected. A later type-4 candidate opened the owned page. |
| Save a hidden type-4 anchor through native editing | The anchor remained usable, but its text became visible after the edit/save cycle. |

## Status

The investigation is parked. It established useful format and native-app behavior, but not a safe general writer. No production writer is integrated, and no original notebook was modified. The Reader and Bridge workflow therefore leaves `.note` files untouched and does not claim native Digest-to-notebook backlinks.

The parser's tests cover the checked-in public fixtures and malformed in-memory inputs. They do not establish compatibility with every file version, prove arbitrary reference creation, or authorize experiments on personal notebooks. Further work would require a disposable native-created pair, byte-preservation checks, and controlled readback/save testing.
