import React from 'react';
import '../Styles/Project.less';
import ContactForm from '../Components/ContactForm';
import ContactInfo from '../Components/ContactInfo';

export default class Contact extends React.Component {
    constructor(props) {
        super(props);
    }
    render() {
        return(
            <div className="contact">
                <h1> Contact Me </h1>
                <div className="row">
                    <ContactForm />
                    <ContactInfo />
                </div>
                <div className="layover">

                </div>
            </div>

        )
    }
}
