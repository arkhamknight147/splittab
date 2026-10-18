"""End-to-end test: host + 3 diners on separate browsers (separate phones).
Prereqs: pip install playwright pillow && playwright install chromium
Run:     npm run db:local && npm run dev:mock     (in another terminal)
         python tests/e2e.py [base_url]           (default http://127.0.0.1:8787)
"""
import asyncio, re, os, sys, tempfile
from PIL import Image
from playwright.async_api import async_playwright

B = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:8787'
OUT = tempfile.mkdtemp()
RECEIPT = os.path.join(OUT, 'receipt.jpg'); Image.new('RGB', (600, 1400), 'white').save(RECEIPT)
results = []
def check(cond, msg): results.append(cond); print(('PASS ' if cond else 'FAIL ') + msg)

async def phone(br, errs):
    ctx = await br.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2)
    await ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=B)
    pg = await ctx.new_page()
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: m.type == 'error' and errs.append(m.text))
    return pg

async def main():
    errs = []
    async with async_playwright() as p:
        br = await p.chromium.launch()
        h = await phone(br, errs)
        await h.goto(B + '/')
        # static assets & meta (#5, #9, #11)
        check(await h.evaluate("getComputedStyle(document.querySelector('#btnScan')).backgroundColor") == 'rgb(15, 23, 42)', 'compiled app.css styles the page (no CDN)')
        check(await h.locator('meta[property="og:image"]').count() == 1, 'og:image meta present')
        for asset, ctype in [('/og.png', 'image/png'), ('/favicon.ico', 'image/'), ('/favicon.svg', 'image/svg'), ('/app.css', 'text/css')]:
            r = await h.request.get(B + asset)
            check(r.ok and ctype in r.headers.get('content-type', ''), f'{asset} served as {r.headers.get("content-type")}')

        await h.fill('#hostName', 'Nishant'); await h.fill('#hostVpa', 'nish@okhdfcbank')
        await h.fill('#participantsInput', 'Rohan, Priya, Amit'); await h.fill('#actualPaidInput', '110')
        await h.set_input_files('#billFileInput', RECEIPT)
        await h.wait_for_function("document.getElementById('fileNameDisplay').textContent.includes('KB')")
        await h.click('#btnScan'); await h.wait_for_selector('#viewReview:not(.hidden)')

        # #2 unusual paid amount: warn, require a second tap
        check('less than half' in await h.inner_text('#reviewCheck'), 'warns when amount paid < 50% of printed total')
        await h.click('#btnCreateRoom'); await h.wait_for_timeout(300)
        check(await h.is_visible('#viewReview'), 'first Create tap is blocked by the warning')
        await h.fill('#reviewActualPaid', '1100'); await h.wait_for_timeout(100)
        check('Discount of' in await h.inner_text('#reviewCheck') and 'less than half' not in await h.inner_text('#reviewCheck'), 'warning clears; discount explained')
        # #3 discount + round-off feed the check
        await h.fill('[data-charge="discount_paise"]', '31'); await h.fill('[data-charge="grand_total_paise"]', '1300')
        txt = await h.inner_text('#reviewCheck')
        check('discount' in txt and '✓' in txt, f'printed discount reconciles the check: "{txt.splitlines()[0]}"')
        await h.fill('[data-charge="discount_paise"]', ''); await h.fill('[data-charge="round_off_paise"]', '-0.5'); await h.fill('[data-charge="grand_total_paise"]', '1330.5')
        check('round-off' in await h.inner_text('#reviewCheck') and '✓' in await h.inner_text('#reviewCheck'), 'negative round-off handled')
        await h.fill('[data-charge="round_off_paise"]', ''); await h.fill('[data-charge="grand_total_paise"]', '1331')
        await h.screenshot(path=OUT + '/1_review.png', full_page=True)
        await h.click('#btnCreateRoom'); await h.wait_for_url(re.compile(r'/r/[a-z0-9]{8}$'))
        url = h.url
        await h.wait_for_selector('#contentSummary:not(.hidden)')
        check(await h.is_visible('#hostLinkBox'), 'host sees private host link box')

        claims = {'Rohan': ['Paneer Butter Masala', 'Garlic Naan', 'Kingfisher Draught Beer'],
                  'Priya': ['Paneer Butter Masala', 'Garlic Naan'], 'Amit': ['Garlic Naan', 'Chicken Biryani']}
        pages = {}
        for name, items in claims.items():
            pg = await phone(br, errs); await pg.goto(url); await pg.wait_for_selector('#viewRoom:not(.hidden)')
            await pg.select_option('#userSelector', label=name); await pg.wait_for_timeout(400)
            for it in items:  # #12 tap fast, no waiting between taps
                await pg.click(f'[data-item]:has-text("{it}")')
            await pg.wait_for_timeout(1200)
            pages[name] = pg
        totals = {}
        for name, pg in pages.items():
            await pg.click('#btnRefresh'); await pg.wait_for_timeout(500)
            totals[name] = await pg.inner_text('#userGrandTotal')
        check([totals['Rohan'], totals['Priya'], totals['Amit']] == ['₹480.95', '₹203.27', '₹415.78'],
              f"fast taps saved; totals {totals['Rohan']} / {totals['Priya']} / {totals['Amit']}")
        href = await pages['Rohan'].get_attribute('#btnUpi', 'href')
        check('pa=nish@okhdfcbank' in href and 'tn=SplitTab-' in href and 'am=480.95' in href, f'UPI link {href}')

        # #1 copy button copies VPA only
        await pages['Rohan'].click('#btnCopyUpi')
        check(await pages['Rohan'].evaluate('navigator.clipboard.readText()') == 'nish@okhdfcbank', 'Copy UPI ID copies only the VPA')

        # #10 identity locks
        intruder = await phone(br, errs); await intruder.goto(url); await intruder.wait_for_selector('#viewRoom:not(.hidden)')
        opt = intruder.locator('#userSelector option', has_text='Rohan')
        check(await opt.get_attribute('disabled') is not None and 'another phone' in await opt.inner_text(), 'Rohan is locked on a second phone')
        check(await intruder.locator('#userSelector option', has_text='Nishant').get_attribute('disabled') is not None, "host's name is locked for diners")
        await pages['Rohan'].click('#tabSummary'); await pages['Rohan'].wait_for_timeout(300)
        check(await pages['Rohan'].locator('[data-status]').count() == 0 and not await pages['Rohan'].is_visible('#hostLinkBox'), 'diner sees no Verify buttons / host link')
        await pages['Rohan'].click('#tabClaim')
        await pages['Priya'].click('#btnSelfPaid'); await pages['Priya'].wait_for_timeout(400)
        await h.click('#btnRefresh'); await h.wait_for_timeout(500)
        check('SAYS PAID' in await h.inner_text('#participantStatusList'), 'host sees Priya "says paid"')
        await h.click('#participantStatusList >> text=Priya >> xpath=../.. >> [data-to="HOST_CONFIRMED"]'); await h.wait_for_timeout(400)
        check('CONFIRMED' in await h.inner_text('#participantStatusList'), 'host verifies Priya')
        # host unlocks Rohan -> intruder can now pick Rohan
        await h.click('#participantStatusList >> text=Rohan >> xpath=../.. >> [data-unlock]'); await h.wait_for_timeout(400)
        await intruder.click('#btnRefresh'); await intruder.wait_for_timeout(400)
        await intruder.select_option('#userSelector', label='Rohan'); await intruder.wait_for_timeout(600)
        check(await intruder.inner_text('#userGrandTotal') == '₹480.95', 'after host unlock, Rohan works on a new phone')
        await pages['Rohan'].screenshot(path=OUT + '/2_rohan.png', full_page=True)
        await h.screenshot(path=OUT + '/3_host_summary.png', full_page=True)

        # host link on another device
        host_link = f"{url}#host={await h.evaluate(f'localStorage.getItem(\"st.host.{url[-8:]}\")')}"
        h2 = await phone(br, errs); await h2.goto(host_link); await h2.wait_for_selector('#viewRoom:not(.hidden)')
        await h2.click('#tabSummary'); await h2.wait_for_timeout(300)
        check('#host=' not in h2.url and await h2.locator('[data-status]').count() > 0, 'host link grants host controls on a 2nd device and is stripped from the URL')

        check(not errs, f'no console errors {errs}')
        await br.close()
    print(f'\n{sum(results)}/{len(results)} checks passed. Screenshots: {OUT}')
    sys.exit(0 if all(results) else 1)

asyncio.run(main())
