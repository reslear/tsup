import { resolve } from 'path'
import execa from 'execa'
import fs from 'fs-extra'
import glob from 'globby'

jest.setTimeout(60000)

const cacheDir = resolve(__dirname, '.cache')
const bin = resolve(__dirname, '../dist/cli.js')

beforeAll(async () => {
  await fs.remove(cacheDir)
  await execa('yarn', { cwd: __dirname })
})

async function run(
  testDir: string,
  files: { [name: string]: string },
  options: {
    flags?: string[]
  } = {}
) {
  testDir = resolve(cacheDir, testDir)

  // Write entry files on disk
  await Promise.all(
    Object.keys(files).map((name) => {
      return fs.outputFile(resolve(testDir, name), files[name], 'utf8')
    })
  )

  // Run tsup cli
  const { exitCode, stdout, stderr } = await execa(
    bin,
    ['input.ts', ...(options.flags || [])],
    {
      cwd: testDir,
    }
  )
  const logs = stdout + stderr
  if (exitCode !== 0) {
    throw new Error(logs)
  }

  // Get output
  const output = await fs.readFile(resolve(testDir, 'dist/input.js'), 'utf8')
  const outFiles = await glob('**/*', {
    cwd: resolve(testDir, 'dist'),
  })

  return {
    output,
    outFiles,
    logs,
    getFileContent(filename: string) {
      return fs.readFile(resolve(testDir, filename), 'utf8')
    },
  }
}

// https://stackoverflow.com/questions/52788380/get-the-current-test-spec-name-in-jest
const getTestName = () => expect.getState().currentTestName

test('simple', async () => {
  const { output, outFiles } = await run(getTestName(), {
    'input.ts': `import foo from './foo';export default foo`,
    'foo.ts': `export default 'foo'`,
  })
  expect(output).toMatchInlineSnapshot(`
    "\\"use strict\\";Object.defineProperty(exports, \\"__esModule\\", {value: true});// foo.ts
    var foo_default = \\"foo\\";

    // input.ts
    var input_default = foo_default;


    exports.default = input_default;
    "
  `)
  expect(outFiles).toMatchInlineSnapshot(`
    Array [
      "input.js",
    ]
  `)
})

test('bundle graphql-tools with --dts flag', async () => {
  await run(
    getTestName(),
    {
      'input.ts': `export { makeExecutableSchema } from 'graphql-tools'`,
    },
    {
      flags: ['--dts'],
    }
  )
})

test('bundle vue and ts-essentials with --dts --dts-resolve flag', async () => {
  await run(
    getTestName(),
    {
      'input.ts': `export * from 'vue'
      export type { MarkRequired } from 'ts-essentials'
      `,
    },
    {
      flags: ['--dts', '--dts-resolve'],
    }
  )
})

test('enable --dts-resolve for specific module', async () => {
  const { getFileContent } = await run(getTestName(), {
    'input.ts': `export * from 'vue'
      export type {MarkRequired} from 'foo'
      `,
    'node_modules/foo/index.d.ts': `
      export type MarkRequired<T, RK extends keyof T> = Exclude<T, RK> & Required<Pick<T, RK>>
      `,
    'node_modules/foo/package.json': `{ "name": "foo", "version": "0.0.0" }`,
    'tsup.config.ts': `
      export default {
        dts: {
          resolve: ['foo']
        },
      }
      `,
  })
  const content = await getFileContent('dist/input.d.ts')
  expect(content).toMatchInlineSnapshot(`
    "export * from 'vue';

    type MarkRequired<T, RK extends keyof T> = Exclude<T, RK> & Required<Pick<T, RK>>

    export { MarkRequired };
    "
  `)
})

test('bundle graphql-tools with --sourcemap flag', async () => {
  await run(
    getTestName(),
    {
      'input.ts': `export { makeExecutableSchema } from 'graphql-tools'`,
    },
    {
      flags: ['--sourcemap'],
    }
  )
})

test('es5 target', async () => {
  const { output, outFiles } = await run(
    getTestName(),
    {
      'input.ts': `
    export class Foo {
      hi (): void {
        let a = () => 'foo'
  
        console.log(a())
      }
    }
    `,
    },
    {
      flags: ['--target', 'es5'],
    }
  )
  expect(output).toMatchInlineSnapshot(`
    "\\"use strict\\";Object.defineProperty(exports, \\"__esModule\\", {value: true});// input.ts
    var Foo = /*@__PURE__*/(function () {
      function Foo () {}

      Foo.prototype.hi = function hi () {
        var a = function () { return \\"foo\\"; };
        console.log(a());
      };

      return Foo;
    }());


    exports.Foo = Foo;
    "
  `)
  expect(outFiles).toMatchInlineSnapshot(`
    Array [
      "input.js",
    ]
  `)
})

test('multiple formats', async () => {
  const { output, outFiles } = await run(
    getTestName(),
    {
      'input.ts': `
    export const a = 1
    `,
    },
    {
      flags: ['--format', 'esm,cjs,iife'],
    }
  )

  expect(output).toMatchInlineSnapshot(`
    "\\"use strict\\";Object.defineProperty(exports, \\"__esModule\\", {value: true});// input.ts
    var a = 1;


    exports.a = a;
    "
  `)
  expect(outFiles).toMatchInlineSnapshot(`
    Array [
      "input.global.js",
      "input.js",
      "input.mjs",
    ]
  `)
})

test('multiple formats and pkg.type is module', async () => {
  const { output, outFiles } = await run(
    getTestName(),
    {
      'input.ts': `
    export const a = 1
    `,
      'package.json': JSON.stringify({ type: 'module' }),
    },
    {
      flags: ['--format', 'esm,cjs,iife'],
    }
  )

  expect(output).toMatchInlineSnapshot(`
    "// input.ts
    var a = 1;
    export {
      a
    };
    "
  `)
  expect(outFiles).toMatchInlineSnapshot(`
    Array [
      "input.cjs",
      "input.global.js",
      "input.js",
    ]
  `)
})

test('multiple formats with legacy output', async () => {
  const { output, outFiles } = await run(
    getTestName(),
    {
      'input.ts': `
    export const a = 1
    `,
      'package.json': JSON.stringify({ type: 'module' }),
    },
    {
      flags: ['--format', 'esm,cjs,iife', '--legacy-output'],
    }
  )

  expect(output).toMatchInlineSnapshot(`
    "\\"use strict\\";Object.defineProperty(exports, \\"__esModule\\", {value: true});// input.ts
    var a = 1;


    exports.a = a;
    "
  `)
  expect(outFiles).toMatchInlineSnapshot(`
    Array [
      "input.js",
      "esm/input.js",
      "iife/input.js",
    ]
  `)
})

test('minify', async () => {
  const { output, outFiles } = await run(
    getTestName(),
    {
      'input.ts': `
    export function foo() {
      return 'foo'
    }
    `,
    },
    {
      flags: ['--minify'],
    }
  )

  expect(output).toMatchInlineSnapshot(`
    "\\"use strict\\";Object.defineProperty(exports, \\"__esModule\\", {value: true});function o(){return\\"foo\\"}exports.foo = o;
    "
  `)
  expect(outFiles).toMatchInlineSnapshot(`
    Array [
      "input.js",
    ]
  `)
})

test('--env flag', async () => {
  const { output, outFiles } = await run(
    getTestName(),
    {
      'input.ts': `
    export const env = process.env.NODE_ENV
    `,
    },
    {
      flags: ['--env.NODE_ENV', 'production'],
    }
  )

  expect(output).toMatchInlineSnapshot(`
    "\\"use strict\\";Object.defineProperty(exports, \\"__esModule\\", {value: true});// input.ts
    var env = \\"production\\";


    exports.env = env;
    "
  `)
  expect(outFiles).toMatchInlineSnapshot(`
    Array [
      "input.js",
    ]
  `)
})

test('import css', async () => {
  const { output, outFiles } = await run(getTestName(), {
    'input.ts': `
    import './foo.css'
    `,
    'postcss.config.js': `
    module.exports = {
      plugins: [require('postcss-simple-vars')()]
    }
    `,
    'foo.css': `
  $color: blue;
  
  .foo {
    color: $color;
  }
    `,
  })

  expect(output).toMatchInlineSnapshot(`"\\"use strict\\";"`)
  expect(outFiles).toMatchInlineSnapshot(`
    Array [
      "input.css",
      "input.js",
    ]
  `)
})

test('external', async () => {
  const { output } = await run(getTestName(), {
    'input.ts': `export {foo} from 'foo'
    export {bar} from 'bar'
    export {baz} from 'baz'
    `,
    'node_modules/foo/index.ts': `export const foo = 'foo'`,
    'node_modules/foo/package.json': `{"name":"foo","version":"0.0.0"}`,
    'node_modules/bar/index.ts': `export const bar = 'bar'`,
    'node_modules/bar/package.json': `{"name":"bar","version":"0.0.0"}`,
    'node_modules/baz/index.ts': `export const baz = 'baz'`,
    'node_modules/baz/package.json': `{"name":"baz","version":"0.0.0"}`,
    'tsup.config.ts': `
    export default {
      external: [/f/, 'bar']
    }
    `,
  })
  expect(output).toMatchInlineSnapshot(`
    "\\"use strict\\";Object.defineProperty(exports, \\"__esModule\\", {value: true});// input.ts
    var _foo = require('foo');
    var _bar = require('bar');

    // node_modules/baz/index.ts
    var baz = \\"baz\\";




    exports.bar = _bar.bar; exports.baz = baz; exports.foo = _foo.foo;
    "
  `)
})

test('disable code splitting to get proper module.exports =', async () => {
  const { output } = await run(
    getTestName(),
    {
      'input.ts': `export = 123`,
    },
    {
      flags: ['--no-splitting'],
    }
  )
  expect(output).toMatchInlineSnapshot(`
    "// input.ts
    module.exports = 123;
    "
  `)
})

test('bundle svelte', async () => {
  const { output, getFileContent } = await run(
    getTestName(),
    {
      'input.ts': `import App from './App.svelte'
      export { App }
      `,
      'App.svelte': `
      <script>
      let msg = 'hello svelte'
      </script>

      <span>{msg}</span>

      <style>
      span {color: red}
      </style>
      `,
    },
    {
      // To make the snapshot leaner
      flags: ['--external', 'svelte/internal'],
    }
  )
  expect(output).toMatchInlineSnapshot(`
    "\\"use strict\\";Object.defineProperty(exports, \\"__esModule\\", {value: true});// App.svelte









    var _internal = require('svelte/internal');
    function create_fragment(ctx) {
      let span;
      return {
        c() {
          span = _internal.element.call(void 0, \\"span\\");
          span.textContent = \`\${msg}\`;
          _internal.attr.call(void 0, span, \\"class\\", \\"svelte-1jo4k3z\\");
        },
        m(target, anchor) {
          _internal.insert.call(void 0, target, span, anchor);
        },
        p: _internal.noop,
        i: _internal.noop,
        o: _internal.noop,
        d(detaching) {
          if (detaching)
            _internal.detach.call(void 0, span);
        }
      };
    }
    var msg = \\"hello svelte\\";
    var App = class extends _internal.SvelteComponent {
      constructor(options) {
        super();
        _internal.init.call(void 0, this, options, null, create_fragment, _internal.safe_not_equal, {});
      }
    };
    var App_default = App;


    exports.App = App_default;
    "
  `)

  expect(await getFileContent('dist/input.css')).toMatchInlineSnapshot(`
    "/* svelte-css:App.svelte.css */
    span.svelte-1jo4k3z {
      color: red;
    }
    "
  `)
})
