module.exports = {
    entry: './src/index',
    output: {
        path: __dirname + '/client/public',
        filename: 'bundle.js',
        publicPath: 'http://localhost:8080/'
    },
    resolve: {
      extensions: ['','.js','.json','.jsx']
    },
    module: {
        loaders: [
            {
                test: /\.(js|jsx)$/,
                loader: 'babel-loader',
                exclude: /node_modules/,
                query: {
                    cacheDirectory: true,
                    presets: ['react', 'es2015']
                }
            },
            {
                test: /\.less$/,
                exclude: /node_modules/,
                loader: "style-loader!css-loader!less-loader"
            },
            { test: /\.css$/, loader: "style-loader!css-loader" },
            { test: /\.png$/, loader: "url-loader?limit=100000" },
            { test: /\.jpg$/, loader: "file-loader" }
        ]
    }
};