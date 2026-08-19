"""Probe launch-deck control geometry at regression viewport sizes."""

from pathlib import Path

from playwright.sync_api import sync_playwright


URL = "http://127.0.0.1:31141/"
OUTPUT = Path(r"C:\Users\BlueJack\AppData\Local\Temp")
SELECTORS = (
    ".chat-empty-launch-deck",
    ".chat-empty-hero",
    ".new-session-context-bar",
    ".chat-empty-composer-frame",
    ".chat-empty-composer-frame .chat-composer-shell",
    ".chat-empty-composer-frame .chat-composer-tools",
    ".chat-empty-state .chat-attach-button",
    ".chat-empty-state .chat-model-config-trigger",
    ".chat-empty-state .chat-sound-button",
    ".chat-empty-state .chat-send-button",
)


with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    for width, height in ((1270, 706), (1920, 1080), (768, 900), (390, 844)):
        page = browser.new_page(viewport={"width": width, "height": height})
        errors: list[str] = []
        page.on("console", lambda message: errors.append(message.text) if message.type == "error" else None)
        page.add_init_script("localStorage.setItem('nova-wallpaper', 'sylphiette'); localStorage.setItem('pi-theme', 'dark');")
        page.goto(URL, wait_until="networkidle", timeout=30_000)
        page.locator(".chat-empty-launch-deck").wait_for(state="visible", timeout=15_000)
        page.wait_for_timeout(600)
        print(f"viewport {width}x{height}")
        for selector in SELECTORS:
            locator = page.locator(selector)
            print(selector, locator.bounding_box(), locator.evaluate("element => ({ position: getComputedStyle(element).position, overflow: getComputedStyle(element).overflow, margin: getComputedStyle(element).margin, top: getComputedStyle(element).top, right: getComputedStyle(element).right, bottom: getComputedStyle(element).bottom, left: getComputedStyle(element).left })"))
        print("shell ancestors", page.locator(".chat-empty-composer-frame .chat-composer-shell").evaluate("element => { const rows = []; for (let node = element; node && rows.length < 5; node = node.parentElement) { const style = getComputedStyle(node); const rect = node.getBoundingClientRect(); rows.push({ tag: node.tagName, className: node.className, x: rect.x, width: rect.width, position: style.position, padding: style.padding }); } return rows; }"))
        for selector in (".chat-empty-state .chat-attach-button", ".chat-empty-state .chat-send-button"):
            print(selector, "ancestors", page.locator(selector).evaluate("element => { const rows = []; for (let node = element.parentElement; node && rows.length < 5; node = node.parentElement) { const style = getComputedStyle(node); const rect = node.getBoundingClientRect(); rows.push({ className: node.className, x: rect.x, width: rect.width, position: style.position }); } return rows; }"))
        print("overflow", page.evaluate("({ x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight })"), "errors", errors)
        page.screenshot(path=OUTPUT / f"ranoa-regression-{width}x{height}.png", full_page=True)
        page.close()
    browser.close()
