import {execFileSync} from 'node:child_process';
import {cp, mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const temporary = await mkdtemp(join(here, '.consumer-'));
try {
    await mkdir(join(temporary, 'node_modules'));
    // Exercise package.json's published types entry, rather than importing a hand-made .d.ts.
    await symlink(root, join(temporary, 'node_modules/ocpp-rpc'), 'dir');
    for (const module of ['Node16', 'NodeNext']) {
        const directory = join(temporary, module);
        await mkdir(directory);
        await cp(join(here, 'esm.mts'), join(directory, 'esm.mts'));
        await cp(join(here, 'commonjs.cts'), join(directory, 'commonjs.cts'));
        await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({
            compilerOptions: {
                strict: true,
                skipLibCheck: false,
                target: 'ES2022',
                module,
                moduleResolution: module,
                esModuleInterop: true,
                outDir: './out',
                types: ['node'],
            },
            include: ['*.mts', '*.cts'],
        }));
        execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', directory], {stdio: 'inherit'});
        execFileSync(process.execPath, [join(directory, 'out/esm.mjs')], {stdio: 'inherit'});
        execFileSync(process.execPath, [join(directory, 'out/commonjs.cjs')], {stdio: 'inherit'});
        console.log(`${module}: strict ESM and CommonJS dynamic-import consumers passed`);
    }
} finally {
    await rm(temporary, {recursive: true, force: true});
}
