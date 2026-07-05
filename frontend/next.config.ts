import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ['192.168.56.1', 'localhost', '127.0.0.1'],
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
    // Suppress webpack warnings from onnxruntime-web dynamic requires
    config.ignoreWarnings = [
      ...(config.ignoreWarnings ?? []),
      { module: /onnxruntime-web/ },
      { file: /onnxruntime-web/ },
      { message: /Critical dependency: require function/ },
    ];
    return config;
  },
  turbopack: {},
};

export default nextConfig;
