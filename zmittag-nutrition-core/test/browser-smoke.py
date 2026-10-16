"""Optional verification only: needs Python Playwright and a Chromium executable.
The calculation modules themselves have no dependency on either package.
"""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
import shutil
from playwright.sync_api import sync_playwright

root = str(Path(__file__).resolve().parent.parent)


class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


server = ThreadingHTTPServer(('127.0.0.1', 0), partial(Quiet, directory=root))
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        executable = shutil.which('chromium') or shutil.which('google-chrome')
        browser = p.chromium.launch(headless=True, executable_path=executable, args=['--no-sandbox'])
        page = browser.new_page()
        requests = []
        page.on('request', lambda req: requests.append(req.url))
        page.goto(f'http://127.0.0.1:{server.server_port}/')
        result = page.evaluate('''async () => {
          const {calculateTargets, STANDARDS} = await import('/core.mjs');
          const profile={ageYears:30,sex:'male',weightKg:75,heightCm:180,activity:{pal:1.6}};
          const request={standard:'us_nasem',profile,allocation:{kind:'explicit',lunch:.4,dinner:.3}};
          const r=calculateTargets(request);
          if(r.daily.kcal.references[0].amount.low!==2871.07) throw Error('Browser EER mismatch');
          if(r.lunch.protein.references[0].amount.low!==24) throw Error('Browser protein mismatch');
          const dga=calculateTargets({...request,standard:'us_dga_2025'});
          if(dga.dinner.sugar.references[0].amount.high!==10) throw Error('Browser DGA meal mismatch');
          for(let i=0;i<500;i++) calculateTargets(request);
          const t=performance.now();
          for(let i=0;i<10000;i++) calculateTargets(request);
          return {energyKcal:r.daily.kcal.references[0].amount.low,
            lunchProteinRDA:r.lunch.protein.references[0].amount.low,
            perCallMs:(performance.now()-t)/10000,standards:Object.keys(STANDARDS).length};
        }''')
        assert all(u.startswith('http://127.0.0.1:') for u in requests)
        print(json.dumps({'browser': browser.version, 'result': result,
                          'requests': requests, 'allRequestsLocal': True}, indent=2))
        browser.close()
finally:
    server.shutdown()
