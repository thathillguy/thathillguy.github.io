import React from 'react';
import '../Styles/Project.less';

import TopNav from '../Components/TopNav.jsx';
import Project from '../Components/Project.jsx';

export default class IndexContainer extends React.Component {

    render() {
        return (<div>
            <TopNav />
            <div className="row">
                <Project text="Intellimed"/>
                <Project text="Intellimed"/>
                <Project text="Intellimed"/>
                <Project text="Intellimed"/>
                <Project text="Intellimed"/>
            </div>
            <div className="row">
                <Project text="Intellimed"/>
                <Project text="Intellimed"/>
                <Project text="Intellimed"/>
                <Project text="Intellimed"/>
                <Project text="Intellimed"/>
            </div>
        </div>)
    }
}
