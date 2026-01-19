/**
 * Logger Module - 日志管理
 *
 * 提供统一的日志记录功能，支持日志级别和过滤
 */

export const LogLevel = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
  SILENT: 4,
};

export class Logger {
  constructor(level = LogLevel.INFO) {
    this.level = level;
    this.logs = [];
    this.maxLogs = 1000; // 最多保留 1000 条日志
  }

  setLevel(level) {
    this.level = level;
  }

  /**
   * 格式化日志时间
   */
  formatTime() {
    return new Date().toLocaleTimeString('zh-CN', { hour12: false });
  }

  /**
   * 记录日志
   */
  log(level, type, message) {
    if (level < this.level) return;

    const logEntry = {
      time: this.formatTime(),
      timestamp: Date.now(),
      level,
      type,
      message,
    };

    this.logs.push(logEntry);
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // 控制台输出
    const icon = {
      'debug': '🔍',
      'action': '⚡',
      'info': 'ℹ️',
      'success': '✅',
      'warn': '⚠️',
      'error': '❌',
      'result': '📊',
    }[type.toLowerCase()] || '📝';

    const methodName = {
      [LogLevel.DEBUG]: 'debug',
      [LogLevel.INFO]: 'log',
      [LogLevel.WARN]: 'warn',
      [LogLevel.ERROR]: 'error',
    }[level];

    console[methodName](`${icon} [${type.toUpperCase()}] ${message}`);
  }

  debug(message) {
    this.log(LogLevel.DEBUG, 'debug', message);
  }

  info(message) {
    this.log(LogLevel.INFO, 'info', message);
  }

  action(message) {
    this.log(LogLevel.INFO, 'action', message);
  }

  success(message) {
    this.log(LogLevel.INFO, 'success', message);
  }

  warn(message) {
    this.log(LogLevel.WARN, 'warn', message);
  }

  error(message) {
    this.log(LogLevel.ERROR, 'error', message);
  }

  result(message) {
    this.log(LogLevel.INFO, 'result', message);
  }

  /**
   * 获取所有日志（或根据类型过滤）
   */
  getLogs(typeFilter = null) {
    if (typeFilter) {
      return this.logs.filter(log => log.type === typeFilter);
    }
    return [...this.logs];
  }

  /**
   * 获取增量日志（从指定索引开始）
   */
  getLogsFromIndex(fromIndex = 0) {
    return this.logs.slice(fromIndex);
  }

  /**
   * 清空日志
   */
  clear() {
    this.logs = [];
  }

  /**
   * 获取日志数量
   */
  get count() {
    return this.logs.length;
  }
}

// 创建全局单例
export const logger = new Logger(LogLevel.INFO);
