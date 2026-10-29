import http from 'node:http';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import qiankun from 'vite-plugin-qiankun';

export default defineConfig({
  base: '/app/ticket/',
  plugins: [vue(), qiankun('ticket', { useDevMode: true })],
  server: {
    headers: {
      'Access-Control-Allow-Origin': '*'
    },
    proxy: {
      // 禁用 keep-alive：后端/nginx 重启后 proxy 不复用死连接（否则窗口期全 502）
      '/api': { target: 'http://localhost:8395', agent: new http.Agent({ keepAlive: false }) },
      // issuer 为空时授权端点走同源路径；开发服务器把它转到本地 IAM。
      '/oauth2': { target: 'http://localhost:8180', changeOrigin: true, agent: new http.Agent({ keepAlive: false }) }
    }
  }
});
