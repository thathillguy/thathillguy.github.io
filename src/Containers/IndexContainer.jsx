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
            active_modal: false
        }
    }
    toggle_modal(value) {
        this.setState({active_modal: value});
    }
    render() {
        return(
            <div className="index">
                <HeaderBar toggle_modal={this.toggle_modal.bind(this)}/>
                <Intro />
                <Modal active={this.state.active_modal} >
                    <Contact toggle_modal={this.toggle_modal.bind(this)} />
                </Modal>
            </div>
        )
    }
}
