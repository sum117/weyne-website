import re
import subprocess

canon_out = subprocess.run(
    ["rg", "--no-filename", "-o", r'CREATE TABLE (IF NOT EXISTS )?"?[a-z_]+"?', "drizzle/canonical/"],
    capture_output=True, text=True,
).stdout
feat_out = subprocess.run(
    ["rg", "--no-filename", "-o", r'CREATE TABLE (IF NOT EXISTS )?"?[a-z_]+"?', "drizzle/", "--glob", "drizzle/*.sql"],
    capture_output=True, text=True,
).stdout


def names(text):
    result = set()
    for line in text.splitlines():
        n = re.sub(r"CREATE TABLE (IF NOT EXISTS )?", "", line).strip().strip('"')
        if n:
            result.add(n)
    return result


canon = names(canon_out)
feat = names(feat_out)
orphan = sorted(feat - canon)

print("canonical tables:", len(canon))
print("feature-slice tables:", len(feat))
print()
print("Tables created ONLY by feature-slice migrations (absent from the production migration path):")
for t in orphan:
    hits = subprocess.run(
        ["rg", "-l", t, "src", "--glob", "!*.test.*"], capture_output=True, text=True
    ).stdout.split()
    print(f"  {t:38s} referenced by {len(hits)} src file(s)")
    for h in hits:
        print(f"      {h}")
