"""End-to-end test: host + 3 diners in separate browsers.
Prereqs: pip install playwright pillow && playwright install chromium
Run:     npm run db:local && npm run dev:mock   (in another terminal)
         python tests/e2e.py
"""
import asyncio, re, os, tempfile
from PIL import Image
OUT = tempfile.mkdtemp()
RECEIPT = os.path.join(OUT, 'receipt.jpg'); Image.new('RGB', (600, 1400), 'white').save(RECEIPT)
from playwright.async_api import async_playwright
B='http://127.0.0.1:8787'
async def main():
    async with async_playwright() as p:
        br = await p.chromium.launch()
        host = await br.new_context(viewport={'width':390,'height':844}, device_scale_factor=2)
        h = await host.new_page(); errs=[]
        h.on('pageerror', lambda e: errs.append(str(e))); h.on('console', lambda m: m.type=='error' and errs.append(m.text))
        await h.goto(B+'/')
        await h.fill('#hostName','Nishant'); await h.fill('#hostVpa','nish@okhdfcbank')
        await h.fill('#participantsInput','Rohan, Priya, Amit'); await h.fill('#actualPaidInput','1100')
        await h.set_input_files('#billFileInput',RECEIPT)
        await h.wait_for_function("document.getElementById('fileNameDisplay').textContent.includes('KB')")
        await h.screenshot(path=OUT+'/s1_setup.png', full_page=True)
        await h.click('#btnScan')
        await h.wait_for_selector('#viewReview:not(.hidden)')
        print('review check:', (await h.inner_text('#reviewCheck')).strip())
        await h.screenshot(path=OUT+'/s2_review.png', full_page=True)
        await h.click('#btnCreateRoom')
        await h.wait_for_url(re.compile(r'/r/[a-z0-9]{8}$'))
        url = h.url; print('room url', url)
        await h.wait_for_selector('#contentSummary:not(.hidden)')
        claims = {'Rohan':['Paneer Butter Masala','Garlic Naan','Kingfisher Draught Beer'],'Priya':['Paneer Butter Masala','Garlic Naan'],'Amit':['Garlic Naan','Chicken Biryani']}
        pages={}
        for name, items in claims.items():
            ctx = await br.new_context(viewport={'width':390,'height':844}, device_scale_factor=2)
            pg = await ctx.new_page(); pg.on('pageerror', lambda e: errs.append(str(e)))
            await pg.goto(url); await pg.wait_for_selector('#viewRoom:not(.hidden)')
            await pg.select_option('#userSelector', label=name)
            for it in items:
                await pg.click(f'[data-item]:has-text("{it}")'); await pg.wait_for_load_state('networkidle')
            pages[name]=pg
        for name, pg in pages.items():
            await pg.click('#btnRefresh'); await pg.wait_for_timeout(400)
            print(name, await pg.inner_text('#userGrandTotal'), await pg.get_attribute('#btnUpi','href'))
        await pages['Rohan'].screenshot(path=OUT+'/s3_rohan.png', full_page=True)
        await pages['Priya'].click('#btnSelfPaid'); await pages['Priya'].wait_for_timeout(400)
        await h.click('#btnRefresh'); await h.wait_for_timeout(500)
        print('host summary:\n', await h.inner_text('#participantStatusList')); print(await h.inner_text('#reconLine'))
        await h.click('[data-status][data-to="HOST_CONFIRMED"] >> nth=1'); await h.wait_for_timeout(400)
        await h.screenshot(path=OUT+'/s4_summary.png', full_page=True)
        # XSS probe via manual entry
        x = await host.new_page(); await x.goto(B+'/')
        await x.fill('#hostName','Ho'); await x.fill('#hostVpa','ho@ybl'); await x.fill('#participantsInput',"D'Souza")
        await x.click('#btnManual'); await x.fill('[data-f=item_name]','<img src=x onerror=alert(1)>'); await x.fill('[data-f=price]','100')
        await x.click('#btnCreateRoom'); await x.wait_for_url(re.compile(r'/r/')); await x.wait_for_timeout(500)
        await x.click('#tabClaim'); await x.wait_for_timeout(300)
        print('xss rendered as text:', '<img' in (await x.inner_text('#menuContainer')))
        print('errors:', errs)
        await br.close()
asyncio.run(main())
