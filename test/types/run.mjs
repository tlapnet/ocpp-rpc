import {execFileSync} from 'node:child_process';
import {access, cp, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
// Keep the consumer outside the checkout so package declarations cannot accidentally
// resolve missing runtime type dependencies from this project's devDependencies.
const temporary = await mkdtemp(join(tmpdir(), 'ocpp-rpc-types-'));
const npmCommand = process.env.npm_execpath ? process.execPath : 'npm';
const npmPrefix = process.env.npm_execpath ? [process.env.npm_execpath] : [];
try {
    // Declarations must already have been built, as in the release/Git prepare path.
    const packed = JSON.parse(execFileSync(npmCommand, [...npmPrefix, 'pack', '--ignore-scripts', '--json', '--pack-destination', temporary], {
        cwd: root,
        encoding: 'utf8',
    }));
    await writeFile(join(temporary, 'package.json'), JSON.stringify({name: 'ocpp-rpc-types-consumer', version: '0.0.0', private: true}));
    execFileSync(npmCommand, [...npmPrefix, 'install', join(temporary, packed[0].filename), '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false'], {
        cwd: temporary,
        stdio: 'inherit',
    });
    await access(join(temporary, 'node_modules/ocpp-rpc/types/index.d.ts'));
    await access(join(temporary, 'node_modules/ocpp-rpc/schemas/openchargealliance/ocpp1.6/Heartbeat.json'));
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
        console.log(`${module}: packaged strict ESM and CommonJS dynamic-import consumers passed`);
    }
} finally {
    await rm(temporary, {recursive: true, force: true});
}
