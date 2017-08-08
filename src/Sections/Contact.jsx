import React from 'react';
import '../Styles/Project.less';
import ContactForm from '../Components/ContactForm';

export default class Contact extends React.Component {
    constructor(props) {
        super(props);
    }
    render() {
        return(
            <div className="contact">
                    <ContactForm toggle_modal={this.props.toggle_modal}/>
            </div>

        )
    }
}
