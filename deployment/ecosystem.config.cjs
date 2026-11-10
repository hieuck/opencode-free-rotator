// OpenCode Free Rotator - PM2 Ecosystem Configuration
//
// Usage:
//   pm2 start ecosystem.config.cjs
//   pm2 save
//   pm2 startup  # Enable auto-start on boot
//
// Management:
//   pm2 status
//   pm2 logs opencode-rotator
//   pm2 monit
//   pm2 restart opencode-rotator
//   pm2 stop opencode-rotator

module.exports = {
  apps: [{
    name: 'opencode-rotator',
    script: 'server.mjs',
    
    // Execution mode
    instances: 1,
    exec_mode: 'fork',
    
    // Auto-restart configuration
    autorestart: true,
    watch: false,
    max_memory_restart: '2G',
    
    // Restart on failure
    min_uptime: '10s',
    max_restarts: 10,
    restart_delay: 5000,
    
    // Environment
    env: {
      NODE_ENV: 'production',
    },
    
    // Logging
    error_file: 'logs/error.log',
    out_file: 'logs/output.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    merge_logs: true,
    
    // Advanced options
    listen_timeout: 10000,
    kill_timeout: 5000,
    
    // Process management
    wait_ready: true,
    shutdown_with_message: true,
  }],
  
  // Deployment configuration (optional)
  deploy: {
    production: {
      user: 'deploy',
      host: 'your-server.com',
      ref: 'origin/master',
      repo: 'git@github.com:yourusername/opencode-free-rotator.git',
      path: '/var/www/opencode-rotator',
      'post-deploy': 'npm install && pm2 reload ecosystem.config.cjs --env production',
    },
  },
};
