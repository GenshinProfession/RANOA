import argparse
import hashlib
from pathlib import Path

from playwright.sync_api import sync_playwright


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


parser = argparse.ArgumentParser(description="Verify that RANOA imports a document as a path.")
parser.add_argument("--url", default="http://127.0.0.1:31141")
parser.add_argument("--file", default="package.json")
args = parser.parse_args()

source = Path(args.file).resolve()
if not source.is_file():
    raise SystemExit(f"Source file does not exist: {source}")

managed_path = None
with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page()
    page.goto(args.url, wait_until="domcontentloaded")
    page.wait_for_load_state("networkidle")
    assert "RANOA" in page.title()
    identity = page.request.get(f"{args.url}/api/runtime/identity")
    assert identity.ok
    assert identity.json()["product"] == "RANOA"
    textarea = page.locator('[data-chat-input="true"]')
    textarea.wait_for(state="visible")
    page.locator('input[type="file"][multiple]').set_input_files(str(source))
    textarea.wait_for()
    page.wait_for_function(
        "element => element.value.includes('.ranoa') && element.value.includes('attachments')",
        arg=textarea.element_handle(),
    )
    value = textarea.input_value().strip()
    managed_path = Path(value.splitlines()[-1])
    assert managed_path.is_absolute(), value
    assert managed_path.is_file(), managed_path
    assert digest(managed_path) == digest(source)
    assert source.read_text(encoding="utf-8") not in value
    print(managed_path)
    browser.close()

# Leave no fixture in the user's attachment library after the smoke test.
if managed_path:
    managed_path.unlink()
    managed_path.parent.rmdir()
