import React from 'react';
import '../Styles/Project.less';

import HeaderBar from '../Components/HeaderBar';
import Intro from '../Sections/Intro';
import About from '../Sections/About';
import Contact from '../Sections/Contact';

export default class IndexContainer extends React.Component {
    constructor(props){
        super(props);
        this.state = {

        }
    }
    render() {
        return(
            <div className="index">
                <HeaderBar />
                <Intro />
                <Contact />
            </div>
        )
    }
}
