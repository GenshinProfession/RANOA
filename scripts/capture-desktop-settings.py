from pathlib import Path
import sys

from playwright.sync_api import sync_playwright


output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else Path.home() / ".ranoa" / "previews" / "desktop-settings.png"
output.parent.mkdir(parents=True, exist_ok=True)

desktop_bridge = """
window.ranoaDesktop = {
  platform: 'win32',
  getPathForFile: () => '',
  pet: {
    show: async () => {}, hide: async () => {}, setState: async () => true,
    setTheme: async () => true, onState: () => () => {}, onTheme: () => () => {}
  }
};
"""

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(viewport={"width": 1440, "height": 900}, device_scale_factor=1)
    context.add_init_script(desktop_bridge)
    page = context.new_page()
    page.goto("http://127.0.0.1:31141/")
    page.wait_for_load_state("networkidle")
    page.get_by_text("设置", exact=True).last.click()
    page.get_by_text("外观", exact=True).click()
    page.wait_for_selector(".appearance-companion-card")
    page.wait_for_timeout(650)
    page.screenshot(path=str(output), full_page=True)
    browser.close()

print(output)
