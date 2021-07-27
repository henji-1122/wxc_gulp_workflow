const path = require('path')
const gulp = require('gulp')
const gulpLoadPlugins = require('gulp-load-plugins') // 自动加载gulp插件
const minimist = require('minimist') // 命令行参数解析引擎
const del = require('del') // del并不是gulp的插件，但是字gulp中可以使用，因为使用gulp定义任务时，gulp的任务并不一定通过src去找文件流最终pipe到dist当中，我们也可以通过写代码去实现这个构建过程：例如del这个模块就可以自动帮我们删除指定的那些文件，而且他是一个promise方法，gulp任务是支持promise这种模式的。
const Comb = require('csscomb') // 对css进行版本支持
const standard = require('standard') // 以标准库编写脚本
const browserSync = require('browser-sync')  // 浏览器实时、快速响应更改并自动刷新页面
const autoprefixer = require('autoprefixer') // 样式中自动添加浏览器厂商前缀
const cssnano = require('cssnano') // 基于postcss构建的css优化工具，对css文件多方面的优化

const config = require('./config')
const data = require('./data')

const $ = gulpLoadPlugins()
const bs = browserSync.create() // browser-sync提供了一个create方法去创建一个服务
const argv = minimist(process.argv.slice(2))
const isProd = process.env.NODE_ENV
  ? process.env.NODE_ENV === 'production'
  : argv.production || argv.prod || false

const clean = () => {
  // del返回的是一个promise函数，del完成过后他可以去标记clean任务完成
  return del([config.temp, config.dest])
}

const lint = done => {
  const comb = new Comb(require('./.csscomb.json'))
  comb.processPath(config.src)
  const cwd = path.join(__dirname, config.src)
  standard.lintFiles(config.paths.scripts, { cwd, fix: true }, done)
}

const style = () => {
  return gulp
    .src(config.paths.styles, {
      cwd: config.src,
      base: config.src,
      sourcemaps: !isProd
    })
    .pipe($.plumber({ errorHandler: $.sass.logError }))
    .pipe(
      $.sass.sync({
        outputStyle: 'expanded',
        precision: 10,
        includePaths: ['.']
      })
    )
    .pipe($.postcss([autoprefixer()]))
    .pipe(gulp.dest(config.temp, { sourcemaps: '.' }))
    .pipe(bs.reload({ stream: true }))
}

const script = () => {
  return gulp
    .src(config.paths.scripts, {
      cwd: config.src,
      base: config.src,
      sourcemaps: !isProd
    })
    .pipe($.plumber())
    .pipe($.babel({ presets: ['@babel/preset-env'] })) // 若不传presets则转换不完全
    .pipe(gulp.dest(config.temp, { sourcemaps: '.' }))
    .pipe(bs.reload({ stream: true }))
}

const page = () => {
  return gulp
    .src(config.paths.pages, {
      cwd: config.src,
      base: config.src,
      ignore: ['{layouts,partials}/**']
    })
    .pipe($.plumber())
    .pipe(
      $.swig({ 
        defaults: { 
          cache: false, //可能会因为swig模板引擎缓存的机制导致页面不会变
          locals: data(`${config.src}/data`) 
        } 
      })  
    )
    .pipe(gulp.dest(config.temp))
  // use bs-html-injector instead
  // .pipe(bs.reload({ stream: true }))
}

const useref = () => { // 构建注释处理任务
  // https://beautifier.io
  const beautifyOpts = { indent_size: 2, max_preserve_newlines: 1 }
  // https://github.com/mishoo/UglifyJS2#minify-options
  const uglifyOpts = { compress: { drop_console: true } }
  // https://cssnano.co/guides/
  const postcssOpts = [cssnano({ safe: true, autoprefixer: false })]
  // https://github.com/kangax/html-minifier#options-quick-reference
  const htmlminOpts = { //默认只删除空白符等，但换行符、行内样式及js并不压缩,要指定对应的参数
    collapseWhitespace: true,
    minifyCSS: true,
    minifyJS: true,
    processConditionalComments: true,
    removeComments: true,
    removeEmptyAttributes: true,
    removeScriptTypeAttributes: true,
    removeStyleLinkTypeAttributes: true
  }

  return gulp
    .src(config.paths.pages, { cwd: config.temp, base: config.temp })
    .pipe($.plumber())
    .pipe($.useref({ searchPath: ['.', '..'] }))
    .pipe(
      $.if(
        /\.js$/,
        $.if(isProd, $.uglify(uglifyOpts), $.beautify.js(beautifyOpts))
      )
    )
    .pipe(
      $.if(
        /\.css$/,
        $.if(isProd, $.postcss(postcssOpts), $.beautify.css(beautifyOpts))
      )
    )
    .pipe(
      $.if(
        /\.html$/,
        $.if(isProd, $.htmlmin(htmlminOpts), $.beautify.html(beautifyOpts))
      )
    )
    .pipe(gulp.dest(config.dest))
}

const image = () => {
  return gulp
    .src(config.paths.images, {
      cwd: config.src,
      base: config.src,
      since: gulp.lastRun(image)
    })
    .pipe($.plumber())
    .pipe($.if(isProd, $.imagemin()))
    .pipe(gulp.dest(config.dest))
}

const font = () => {
  return gulp
    .src(config.paths.fonts, { cwd: config.src, base: config.src })
    .pipe($.plumber())
    .pipe($.if(isProd, $.imagemin()))
    .pipe(gulp.dest(config.dest))
}

const extra = () => { // 其他文件拷贝任务
  return gulp
    .src('**', { cwd: config.public, base: config.public, dot: true })
    .pipe(gulp.dest(config.dest))
}

const measure = () => {
  return gulp
    .src('**', { cwd: config.dest })
    .pipe($.plumber())
    .pipe(
      $.size({
        title: `${isProd ? 'Prodcuction' : 'Development'} mode build`,
        gzip: true
      })
    )
}

const upload = () => {
  return gulp
    .src('**', { cwd: config.dest })
    .pipe($.plumber())
    .pipe(
      $.ghPages({
        cacheDir: `${config.temp}/publish`,
        branch: argv.branch === undefined ? 'gh-pages' : argv.branch
      })
    )
}

const devServer = () => {
  // 监视src下的文件并执行相应任务  
  gulp.watch(config.paths.styles, { cwd: config.src }, style) // 路径:要执行的任务
  gulp.watch(config.paths.scripts, { cwd: config.src }, script)
  gulp.watch(config.paths.pages, { cwd: config.src }, page)
  gulp.watch(
    [config.paths.images, config.paths.fonts],
    { cwd: config.src },
    bs.reload
  )
  gulp.watch('**', { cwd: config.public }, bs.reload)

  bs.init({ // 通过init方法初始化服务相关配置
    notify: false, //显示browser-sync是否连接上，会影响页面调试样式
    port: argv.port === undefined ? 2080 : argv.port, // 默认端口
    open: argv.open === undefined ? false : argv.open, // 默认自动打开浏览器
    plugins: [`bs-html-injector?files[]=${config.temp}/*.html`],
    server: {
      baseDir: [config.temp, config.src, config.public], // 指定网站的根目录
      // 开发阶段优先于baseDir的一个配置，当请求发生先看在routes有没有相关的配置，如果没有再走baseDir
      routes: { '/node_modules': 'node_modules' }
    }
  })
}

const distServer = () => {
  bs.init({
    notify: false,
    port: argv.port === undefined ? 2080 : argv.port,
    open: argv.open === undefined ? false : argv.open,
    server: config.dest
  })
}

const compile = gulp.parallel(style, script, page)

const serve = gulp.series(compile, devServer)

const build = gulp.series(
  clean,
  gulp.parallel(gulp.series(compile, useref), image, font, extra),
  measure
)

const start = gulp.series(build, distServer)

const deploy = gulp.series(build, upload)

module.exports = {
  clean,
  lint,
  style,
  script,
  page,
  useref,
  image,
  font,
  extra,
  measure,
  upload,
  devServer,
  distServer,
  compile,
  serve,
  build,
  start,
  deploy
}
