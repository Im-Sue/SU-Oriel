import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom 不实现 canvas；xterm 初始化会探测 getContext，测试里提供最小桩即可。
Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
  value: () => ({
    clearRect: () => undefined,
    createLinearGradient: () => ({
      addColorStop: () => undefined
    }),
    fillRect: () => undefined,
    getImageData: () => ({
      data: new Uint8ClampedArray([0, 0, 0, 255])
    }),
    measureText: () => ({
      width: 0
    }),
    putImageData: () => undefined
  })
});

afterEach(() => {
  cleanup();
});
