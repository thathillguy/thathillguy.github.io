import React from 'react';
import ReactDOM from 'react-dom';
import MuiThemeProvider from 'material-ui/styles/MuiThemeProvider';
import Portfolio from './Containers/IndexContainer.jsx';

class App extends React.Component {
    render () {
        return (
         <MuiThemeProvider>
            <Portfolio />
        </MuiThemeProvider>);
    }
}

ReactDOM.render(<App/>, document.getElementById('app'));
