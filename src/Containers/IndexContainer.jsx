import React from 'react';
import '../Styles/Project.less';

import HeaderBar from '../Components/HeaderBar';
import Intro from '../Sections/Intro';
import Contact from '../Sections/Contact';
import CCA from '../Sections/CCA';


export default class IndexContainer extends React.Component {
    constructor(props){
        super(props);
        this.state = {
            active: 'intro'
        }
    }
    contact(value) {
        this.setState({active: value});
    }
    render() {
        let display;
        switch (this.state.active) {
            case 'intro':
                display = <Intro />;
                break;
        }
        console.log(this.state.active);
        return(
            <div className="index">
                <HeaderBar contact={this.contact.bind(this)}/>
                {display}
            </div>
        )
    }
}
