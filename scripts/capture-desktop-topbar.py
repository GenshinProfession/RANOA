from pathlib import Path
import sys

from playwright.sync_api import sync_playwright


output = (
    Path(sys.argv[1]).resolve()
    if len(sys.argv) > 1
    else Path.home() / ".ranoa" / "previews" / "desktop-topbar.png"
)
output.parent.mkdir(parents=True, exist_ok=True)

desktop_bridge = """
window.ranoaDesktop = {
  platform: 'win32',
  getPathForFile: () => '',
  menu: { open: async () => true },
  window: { minimize: async () => true, toggleMaximize: async () => true, close: async () => true },
  pet: {
    show: async () => {}, hide: async () => {}, setState: async () => true,
    setTheme: async () => true, present: async () => true, reply: async () => true,
    onState: () => () => {}, onTheme: () => () => {}, onMessage: () => () => {}, onReply: () => () => {}
  }
};
"""

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    context = browser.new_context(
        viewport={"width": 1440, "height": 900}, device_scale_factor=1
    )
    context.add_init_script(desktop_bridge)
    page = context.new_page()
    page.goto("http://127.0.0.1:31141/")
    page.wait_for_load_state("networkidle")
    page.wait_for_selector(".desktop-application-bar")
    page.wait_for_selector(".desktop-window-controls")
    assert page.locator(".desktop-window-controls button").count() == 3
    sessions = page.locator(".session-item")
    if sessions.count() > 0:
        sessions.first.click()
        page.wait_for_selector(".topbar-conversation-meta-end .topbar-session-pill")
        topbar_box = page.locator(".app-shell-topbar-primary").bounding_box()
        stats_box = page.locator(".topbar-conversation-meta-end .topbar-session-pill").bounding_box()
        assert topbar_box and stats_box
        topbar_center = topbar_box["y"] + topbar_box["height"] / 2
        stats_center = stats_box["y"] + stats_box["height"] / 2
        assert abs(topbar_center - stats_center) <= 2
    page.wait_for_timeout(700)
    page.screenshot(path=str(output), full_page=True)
    browser.close()

print(output)
