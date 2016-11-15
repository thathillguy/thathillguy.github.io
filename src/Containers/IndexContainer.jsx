import React from 'react';
import Paper from 'material-ui/Paper';

import TopNav from '../Components/TopNav.jsx'
import WelcomeComponent from '../Components/WelcomeComponent.jsx'

const style = {
    height: 100,
    width: 100,
    margin: 20,
    textAlign: 'center',
    display: 'inline-block',
};

export default class IndexContainer extends React.Component {

    render() {
        return (<div>
            <TopNav />
            <WelcomeComponent />
        </div>)
    }
}
