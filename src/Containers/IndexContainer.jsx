import React from 'react';

import TopNav from '../Components/TopNav.jsx';
import WelcomeComponent from '../Components/WelcomeComponent.jsx';
import Project from '../Components/Project.jsx';


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
            <Project />
        </div>)
    }
}
