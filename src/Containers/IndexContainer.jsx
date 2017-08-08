import React from 'react';
import '../Styles/Project.less';

import HeaderBar from '../Components/HeaderBar';
import Intro from '../Sections/Intro';
import About from '../Sections/About';
import Contact from '../Sections/Contact';
import ActiveBackground from '../Components/ActiveBackgound'
import Modal from '../Components/Modal';

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
            case 'contact':
                display = <Contact />
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
