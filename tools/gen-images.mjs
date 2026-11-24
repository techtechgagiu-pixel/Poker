// Genereaza imaginile (masa, locatia, 9 portrete) prin Atlas Cloud, cel mai ieftin model.
// Rulare: node tools/gen-images.mjs   (foloseste ATLAS_API_KEY daca exista)
import fs from 'node:fs';
import path from 'node:path';
const MODEL = 'openai/gpt-image-2.5-sunburst/text-to-image';
const BASE = 'https://api.atlascloud.ai/api/v1';
const headers = { 'Content-Type': 'application/json' };
if (process.env.ATLAS_API_KEY) headers.Authorization = 'Bearer ' + process.env.ATLAS_API_KEY;
const out = path.resolve('public/img');
fs.mkdirSync(out, { recursive: true });
const chars = JSON.parse(fs.readFileSync('characters.json', 'utf8'));
const jobs = [
  { file: 'location.png', size: '1536x1024', quality: 'low',
    prompt: 'Wide cinematic shot of a luxurious Las Vegas casino high-stakes poker television studio, empty, glowing red and gold neon signs, glittering chandeliers, rows of slot machines blurred in the background, dramatic spotlights, deep dark atmosphere, broadcast set design, no people, no text, no logos' },
  { file: 'table.png', size: '1536x1024', quality: 'medium',
    prompt: 'Overhead photo of a large empty oval green felt card table with a padded dark brown leather armrest edge and thin gold trim, seen from directly above, the table fills the whole picture, soft studio lighting, clean and plain, nothing on the table' },
  ...chars.map(c => ({ file: `${c.id}.png`, size: '1024x1024', quality: 'low',
    prompt: `Square head-and-shoulders portrait of a weird eccentric human character: ${c.look}. Stylized colorful illustration, expressive face looking at camera, neon Las Vegas rim lighting in magenta and gold, plain dark background, centered, no text, no letters` })),
];
async function run(job) {
  const dest = path.join(out, job.file);
  if (fs.existsSync(dest)) return console.log('skip', job.file);
  const r = await fetch(BASE + '/model/generateImage', { method: 'POST', headers,
    body: JSON.stringify({ model: MODEL, prompt: job.prompt, size: job.size, quality: job.quality }) });
  const j = await r.json();
  let d = j.data || j;
  if (!d.id) throw new Error(job.file + ': ' + JSON.stringify(j).slice(0, 300));
  for (let i = 0; i < 90 && !(d.outputs && d.outputs.length); i++) {
    if (d.status === 'failed') throw new Error(job.file + ' failed ' + JSON.stringify(d).slice(0, 300));
    await new Promise(r => setTimeout(r, 2000));
    const p = await (await fetch(`${BASE}/model/prediction/${d.id}`, { headers })).json();
    d = p.data || p;
  }
  const img = await fetch(d.outputs[0]);
  fs.writeFileSync(dest, Buffer.from(await img.arrayBuffer()));
  console.log('ok', job.file);
}
await Promise.all(jobs.map(j => run(j).catch(e => console.error('ERR', e.message))));
