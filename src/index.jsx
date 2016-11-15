import React from 'react';
import ReactDOM from 'react-dom';
import MuiThemeProvider from 'material-ui/styles/MuiThemeProvider';
import IndexContainer from './Containers/IndexContainer.jsx';

class App extends React.Component {
    render () {
        return (<MuiThemeProvider>
            <IndexContainer />
        </MuiThemeProvider>);
    }
}

ReactDOM.render(<App/>, document.getElementById('app'));