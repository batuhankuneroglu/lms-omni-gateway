# Attribution and third-party notices

## OpenAI-compatible endpoint foundation

This gateway is derived from **sonct/openai-compat-endpoint**, which is itself a
fork of **lmstudio/openai-compat-endpoint**. Credit for that original implementation
remains with Sonct and the LM Studio contributors. The gateway adds provider profiles,
discovery, reporting, image commands, native configuration changes, and startup behavior.

Both upstream package manifests declare **ISC**. That declaration is retained in
this project's package metadata and LICENSE. Upstream source references:

- [Sonct's plugin](https://lmstudio.ai/sonct/openai-compat-endpoint)
- [Sonct's package manifest](https://lmstudio.ai/sonct/openai-compat-endpoint/files/package.json)
- [LM Studio's original plugin](https://lmstudio.ai/lmstudio/openai-compat-endpoint)
- [Original package manifest](https://lmstudio.ai/lmstudio/openai-compat-endpoint/files/package.json)

The modification copyright in LICENSE does not replace attribution for the
original work or claim ownership of upstream authors' contributions.

## Generated LM Studio registration loader

`.lmstudio/entry.ts` is generated LM Studio registration scaffolding. The
[LM Studio CLI](https://github.com/lmstudio-ai/lms) is MIT licensed; its notice is
preserved here for the included loader. Other generated bundles are built locally.

```text
MIT License

Copyright (c) 2024 LM Studio

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Package dependencies

The LM Studio SDK, OpenAI SDK, Zod, TypeScript, esbuild, and other dependencies
retain their own licenses. They are installed from the lockfile, not vendored in
this source repository. Refer to the packages' supplied notices and LICENSE files.

Provider names and LM Studio are used to describe interoperability. This project
is independently maintained and is not endorsed by those providers or LM Studio.
