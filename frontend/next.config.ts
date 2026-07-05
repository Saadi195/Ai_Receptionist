import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow WASM files required by onnxruntime-web (Silero VAD model)
  webpack: (config) => {
    config.resolve.extensions = [
      ...(config.resolve.extensions ?? []),
      ".wasm",
    ];
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    return config;
  },
};

export default nextConfig;
